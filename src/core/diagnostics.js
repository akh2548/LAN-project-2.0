const { createPlatformAdapter } = require('./platform');
const config = require('../config');

class NetworkDiagnostics {
  constructor(platformAdapter = null) {
    this.adapter = platformAdapter || createPlatformAdapter();
  }

  /**
   * Converts an IPv4 dotted-quad string into an unsigned 32-bit integer.
   * @param {string} ip 
   * @returns {number}
   */
  static ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
  }

  /**
   * Converts an unsigned 32-bit integer into an IPv4 dotted-quad string.
   * @param {number} long 
   * @returns {string}
   */
  static longToIp(long) {
    return [
      (long >>> 24) & 255,
      (long >>> 16) & 255,
      (long >>> 8) & 255,
      long & 255
    ].join('.');
  }

  /**
   * Calculates CIDR prefix length (e.g. 24 for 255.255.255.0).
   * @param {string} netmask 
   * @returns {number}
   */
  static netmaskToCidr(netmask) {
    if (!netmask) return 24;
    const long = NetworkDiagnostics.ipToLong(netmask);
    let count = 0;
    for (let i = 0; i < 32; i++) {
      if ((long & (1 << (31 - i))) !== 0) count++;
      else break;
    }
    return count;
  }

  /**
   * Computes network address, broadcast address, first usable IP, last usable IP, and total hosts.
   * @param {string} ip 
   * @param {string} netmask 
   */
  static calculateSubnet(ip, netmask) {
    const ipLong = NetworkDiagnostics.ipToLong(ip);
    const maskLong = NetworkDiagnostics.ipToLong(netmask || '255.255.255.0');
    const netLong = (ipLong & maskLong) >>> 0;
    const invMask = (~maskLong) >>> 0;
    const bcastLong = (netLong | invMask) >>> 0;

    const cidr = NetworkDiagnostics.netmaskToCidr(netmask);
    const totalHosts = Math.max(0, bcastLong - netLong - 1);
    const firstUsableLong = (netLong + 1) >>> 0;
    const lastUsableLong = Math.max(firstUsableLong, (bcastLong - 1) >>> 0);

    return {
      networkAddress: NetworkDiagnostics.longToIp(netLong),
      broadcastAddress: NetworkDiagnostics.longToIp(bcastLong),
      firstUsableIp: NetworkDiagnostics.longToIp(firstUsableLong),
      lastUsableIp: NetworkDiagnostics.longToIp(lastUsableLong),
      totalHosts,
      cidr,
      netmask
    };
  }

  /**
   * Validates whether a target IP falls strictly inside the specified subnet.
   * @param {string} targetIp 
   * @param {string} baseIp 
   * @param {string} netmask 
   * @returns {boolean}
   */
  static isIpInSubnet(targetIp, baseIp, netmask) {
    try {
      const targetLong = NetworkDiagnostics.ipToLong(targetIp);
      const baseLong = NetworkDiagnostics.ipToLong(baseIp);
      const maskLong = NetworkDiagnostics.ipToLong(netmask);
      return (targetLong & maskLong) === (baseLong & maskLong);
    } catch {
      return false;
    }
  }

  /**
   * Generates array of all usable IPv4 addresses in the subnet.
   * @param {string} ip 
   * @param {string} netmask 
   * @returns {string[]}
   */
  static generateSubnetIps(ip, netmask) {
    const subnet = NetworkDiagnostics.calculateSubnet(ip, netmask);
    const firstLong = NetworkDiagnostics.ipToLong(subnet.firstUsableIp);
    const lastLong = NetworkDiagnostics.ipToLong(subnet.lastUsableIp);

    const ips = [];
    for (let current = firstLong; current <= lastLong; current++) {
      ips.push(NetworkDiagnostics.longToIp(current));
    }
    return ips;
  }

  /**
   * Runs complete pre-flight network diagnostics check.
   */
  async runPreFlightCheck(options = {}) {
    const lanOnly = options.lanOnly !== undefined ? options.lanOnly : (config.network?.lanOnly ?? true);
    const interfaces = await this.adapter.getNetworkInterfaces();

    // Distinguish wired Ethernet LAN from wireless Wi-Fi interfaces
    const wiredInterfaces = interfaces.filter(i => 
      i.isWired || 
      i.mediaType === 'ethernet' || 
      /ethernet|lan|gbe|gigabit|usb.*ethernet/i.test(i.name) || 
      /ethernet|lan|gbe|gigabit|usb.*ethernet/i.test(i.description || '')
    );
    const wifiInterfaces = interfaces.filter(i => !wiredInterfaces.includes(i));

    let primaryInterface = null;
    let modeNotice = '';

    if (lanOnly) {
      // Prioritize wired Ethernet LAN adapter
      primaryInterface = wiredInterfaces.find(i => i.gateway && i.ip) || wiredInterfaces.find(i => i.ip) || null;
      if (primaryInterface) {
        modeNotice = `Wired Ethernet LAN active (${primaryInterface.name || primaryInterface.description}). Wi-Fi adapters are excluded.`;
      } else {
        modeNotice = 'LAN-Only Mode is active, but no active wired Ethernet cable connection was detected.';
      }
    } else {
      primaryInterface = interfaces.find(i => i.gateway && i.ip) || interfaces[0] || null;
    }

    const report = {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      mode: lanOnly ? 'ethernet_only' : 'all_adapters',
      modeNotice,
      lanOnly,
      allInterfaces: interfaces,
      wiredInterfaces,
      wifiInterfaces,
      activeInterface: primaryInterface,
      subnet: null,
      gatewayStatus: {
        gatewayIp: primaryInterface ? primaryInterface.gateway : null,
        reachable: false,
        latencyMs: null
      },
      readiness: {
        canReadInterfaces: interfaces.length > 0,
        hasLocalIp: !!(primaryInterface && primaryInterface.ip),
        hasGateway: !!(primaryInterface && primaryInterface.gateway),
        isSubnetSafe: false
      },
      warnings: [],
      explanations: [
        {
          topic: 'Client / AP Isolation',
          detail: 'If your router has Guest Network or AP Isolation enabled, connected devices are forbidden from communicating with each other at Layer 2. Only the router gateway will be visible.'
        },
        {
          topic: 'VLAN Separation',
          detail: 'Devices assigned to a separate Virtual Local Area Network (VLAN) cannot be discovered directly via broadcast/ARP from this subnet.'
        },
        {
          topic: 'Firewall & Stealth Mode',
          detail: 'Many Windows, macOS, and Linux computers block ICMP ping by default. The system uses Layer-2 ARP cache interrogation so devices can still be discovered even if ping is blocked.'
        },
        {
          topic: 'Sleeping Devices',
          detail: 'Mobile phones and tablets put their Wi-Fi chipsets into low-power sleep mode, intermittently dropping off the network until woken by traffic or periodic beaconing.'
        },
        {
          topic: 'Switched Network Limits',
          detail: 'Standard Ethernet switches direct traffic only between communicating ports. A program running on one PC cannot sniff general traffic passing between other devices.'
        }
      ]
    };

    if (primaryInterface && primaryInterface.ip && primaryInterface.netmask) {
      report.subnet = NetworkDiagnostics.calculateSubnet(primaryInterface.ip, primaryInterface.netmask);
      report.readiness.isSubnetSafe = report.subnet.totalHosts <= config.scanner.maxSubnetHosts;

      if (!report.readiness.isSubnetSafe) {
        report.warnings.push(`Subnet has ${report.subnet.totalHosts} addresses (larger than /22). Active scanning requires confirmation to avoid network congestion.`);
      }

      if (primaryInterface.gateway) {
        try {
          const pingRes = await this.adapter.pingHost(primaryInterface.gateway, 600);
          report.gatewayStatus.reachable = pingRes.alive;
          report.gatewayStatus.latencyMs = pingRes.timeMs;
        } catch {
          report.gatewayStatus.reachable = false;
        }

        if (!report.gatewayStatus.reachable) {
          report.warnings.push(`Default gateway (${primaryInterface.gateway}) did not respond to ping. The router may block ICMP Echo or local ICMP drivers may be restricted.`);
        }
      } else {
        report.warnings.push('No default gateway configured for the active network adapter. Network may be link-local or isolated.');
      }
    } else {
      if (lanOnly) {
        report.warnings.push('LAN-Only Mode: No active wired Ethernet LAN adapter with an IPv4 address detected. Please ensure your Ethernet cable is plugged in.');
        if (wifiInterfaces.length > 0) {
          report.warnings.push(`Detected Wi-Fi adapter (${wifiInterfaces.map(w => w.name || w.description).join(', ')}), but Wi-Fi is excluded per LAN-Only policy.`);
        }
      } else {
        report.warnings.push('No active IPv4 network interface detected. Ensure Wi-Fi or Ethernet is connected.');
      }
    }

    return report;
  }
}

module.exports = NetworkDiagnostics;

