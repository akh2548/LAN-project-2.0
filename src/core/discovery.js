const net = require('node:net');
const { createPlatformAdapter } = require('./platform');
const NetworkDiagnostics = require('./diagnostics');
const DeviceEnrichment = require('./enrichment');
const config = require('../config');

class DiscoveryEngine {
  constructor(options = {}) {
    this.adapter = options.platformAdapter || createPlatformAdapter();
    this.concurrency = options.concurrency || config.scanner.concurrency;
    this.batchDelayMs = options.batchDelayMs || config.scanner.batchDelayMs;
    this.probeTimeoutMs = options.probeTimeoutMs || config.scanner.probeTimeoutMs;
    this.probePorts = options.probePorts || config.scanner.probePorts;

    this.isScanning = false;
    this.abortController = null;
  }

  /**
   * Attempts a quick TCP probe to a port.
   * Note: The connection does not need to succeed; the attempt forces the OS
   * network stack to resolve the target's MAC address via Layer-2 ARP.
   * @param {string} ip 
   * @param {number} port 
   * @param {number} timeoutMs 
   * @returns {Promise<boolean>} True if port is open
   */
  async probeTcpPort(ip, port, timeoutMs = 250) {
    return new Promise((resolve) => {
      let resolved = false;
      const socket = new net.Socket();

      const finish = (isOpen) => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(isOpen);
        }
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', (err) => {
        // Any error other than EACCES or network down means the packet was routed to the host
        finish(false);
      });

      try {
        socket.connect(port, ip);
      } catch {
        finish(false);
      }
    });
  }

  /**
   * Probes a single host using both ICMP ping and lightweight TCP SYN probing.
   * @param {string} ip 
   */
  async probeHost(ip) {
    // 1. Try ICMP ping
    try {
      const pingRes = await this.adapter.pingHost(ip, this.probeTimeoutMs);
      if (pingRes.alive) {
        return { ip, reachable: true, latencyMs: pingRes.timeMs };
      }
    } catch {
      // Ignore ping failure; proceed to TCP probe
    }

    // 2. Try TCP SYN probe on common port
    for (const port of this.probePorts.slice(0, 2)) {
      const open = await this.probeTcpPort(ip, port, 200);
      if (open) {
        return { ip, reachable: true, latencyMs: null };
      }
    }

    return { ip, reachable: false, latencyMs: null };
  }

  /**
   * Stops an active scan sweep immediately.
   */
  stopScan() {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.isScanning = false;
  }

  /**
   * Performs a complete subnet discovery sweep.
   * @param {object} params
   * @param {string} params.subnetIp Base IP
   * @param {string} params.netmask Subnet Mask
   * @param {Function} params.onProgress Progress callback
   * @returns {Promise<{devices: Array, summary: object}>}
   */
  async runScan({ subnetIp, netmask, onProgress = null } = {}) {
    if (this.isScanning) {
      throw new Error('A scan is already in progress.');
    }

    this.isScanning = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const startTime = Date.now();

    try {
      // 1. Determine target IPs
      let targetIps = [];
      if (subnetIp && netmask) {
        targetIps = NetworkDiagnostics.generateSubnetIps(subnetIp, netmask);
      } else {
        const diag = new NetworkDiagnostics(this.adapter);
        const check = await diag.runPreFlightCheck();
        if (!check.activeInterface || !check.activeInterface.ip) {
          throw new Error('No active network adapter found to scan.');
        }
        targetIps = NetworkDiagnostics.generateSubnetIps(check.activeInterface.ip, check.activeInterface.netmask);
      }

      // Safety limit
      if (targetIps.length > config.scanner.maxSubnetHosts) {
        throw new Error(`Subnet contains ${targetIps.length} hosts, which exceeds safety threshold of ${config.scanner.maxSubnetHosts}.`);
      }

      // 2. Phase 1: Direct ARP table read before probing
      const initialArpEntries = await this.adapter.getArpTable();
      const arpMap = new Map();
      for (const entry of initialArpEntries) {
        arpMap.set(entry.ip, entry.mac);
      }

      if (onProgress) {
        onProgress({
          stage: 'initial_arp',
          scanned: 0,
          total: targetIps.length,
          percent: 5,
          currentIp: '',
          devicesFound: arpMap.size
        });
      }

      // 3. Phase 2: Rate-limited active synthetic ARP seeding
      const reachableIps = new Set();
      const total = targetIps.length;

      for (let i = 0; i < total; i += this.concurrency) {
        if (signal.aborted) {
          break;
        }

        const batch = targetIps.slice(i, i + this.concurrency);
        const probePromises = batch.map(ip => this.probeHost(ip));
        const results = await Promise.all(probePromises);

        for (const res of results) {
          if (res.reachable) {
            reachableIps.add(res.ip);
          }
        }

        const scannedCount = Math.min(i + batch.length, total);
        const percent = Math.round(5 + (scannedCount / total) * 85);

        if (onProgress) {
          onProgress({
            stage: 'probing',
            scanned: scannedCount,
            total,
            percent,
            currentIp: batch[batch.length - 1],
            devicesFound: arpMap.size + reachableIps.size
          });
        }

        if (this.batchDelayMs > 0 && i + this.concurrency < total) {
          await new Promise(r => setTimeout(r, this.batchDelayMs));
        }
      }

      // 4. Phase 3: Post-probe ARP table read
      const updatedArpEntries = await this.adapter.getArpTable();
      for (const entry of updatedArpEntries) {
        arpMap.set(entry.ip, entry.mac);
      }

      // 5. Phase 4: Consolidate discovered devices
      const discoveredDevices = [];
      const allFoundIps = new Set([...arpMap.keys(), ...reachableIps]);

      // Filter only IPs that belong to the scanned subnet
      for (const ip of allFoundIps) {
        if (targetIps.includes(ip)) {
          const mac = arpMap.get(ip) || null;
          const isReachable = reachableIps.has(ip) || arpMap.has(ip);

          discoveredDevices.push({
            ip,
            mac,
            isReachable
          });
        }
      }

      // 6. Phase 5: Enrichment (Vendor OUI, Hostname, Randomized MAC)
      const enrichedDevices = [];
      for (const dev of discoveredDevices) {
        const enriched = await DeviceEnrichment.enrichDevice({
          ip: dev.ip,
          mac: dev.mac,
          adapter: this.adapter
        });

        enrichedDevices.push({
          ...enriched,
          status: dev.isReachable ? 'online' : 'unreachable'
        });
      }

      if (onProgress) {
        onProgress({
          stage: 'completed',
          scanned: total,
          total,
          percent: 100,
          currentIp: '',
          devicesFound: enrichedDevices.length
        });
      }

      const durationMs = Date.now() - startTime;
      return {
        devices: enrichedDevices,
        summary: {
          scannedHosts: targetIps.length,
          devicesFound: enrichedDevices.length,
          durationMs,
          wasAborted: signal.aborted
        }
      };
    } finally {
      this.isScanning = false;
      this.abortController = null;
    }
  }
}

module.exports = DiscoveryEngine;

