const config = require('../config');

class DeviceStateMachine {
  constructor({ database, notifier = null, gatewayIp = null }) {
    this.db = database;
    this.notifier = notifier;
    this.gatewayIp = gatewayIp;
    // Map of mac -> last alert timestamp for flapping suppression
    this.lastAlertTimestamps = new Map();
  }

  /**
   * Sets or updates current gateway IP for anomaly verification.
   */
  setGatewayIp(ip) {
    this.gatewayIp = ip;
  }

  /**
   * Checks if an alert for a MAC should be throttled.
   */
  isThrottled(mac, eventType) {
    const key = `${mac}:${eventType}`;
    const lastTime = this.lastAlertTimestamps.get(key) || 0;
    const now = Date.now();
    if (now - lastTime < config.alerts.debounceWindowMs) {
      return true;
    }
    this.lastAlertTimestamps.set(key, now);
    return false;
  }

  /**
   * Evaluates a batch of discovered devices against the database inventory.
   * @param {Array<object>} discoveredDevices 
   * @returns {Promise<{newDevices: Array, updatedDevices: Array, alerts: Array}>}
   */
  async processScanResults(discoveredDevices) {
    const alerts = [];
    const newDevices = [];
    const updatedDevices = [];
    const seenMacs = [];

    for (const dev of discoveredDevices) {
      // If device has no MAC (silent firewall responder), assign a synthetic identifier
      const macKey = dev.mac || `UNAVAILABLE-${dev.ip}`;
      seenMacs.push(macKey);

      // Check if this is the default gateway
      const isGateway = (this.gatewayIp && dev.ip === this.gatewayIp);
      const existing = this.db.getDeviceByMac(macKey);
      const existingAtIp = this.db.getDeviceByIp ? this.db.getDeviceByIp(dev.ip) : null;

      // Gateway MAC mismatch check (Possible ARP spoofing)
      if (isGateway && existingAtIp && existingAtIp.mac_address !== macKey) {
        const alertMsg = `CRITICAL: Gateway IP ${dev.ip} MAC address changed from ${existingAtIp.mac_address} to ${macKey}! Possible ARP spoofing or rogue DHCP.`;
        const event = this.db.logEvent({
          event_type: 'GATEWAY_MISMATCH',
          severity: 'CRITICAL',
          device_id: existingAtIp.id,
          mac_address: macKey,
          ip_address: dev.ip,
          message: alertMsg
        });
        alerts.push(event);
        if (this.notifier) {
          this.notifier.notify(event);
        }
      }

      // Upsert device in database
      const upsertResult = this.db.upsertDevice({
        mac_address: macKey,
        last_ip: dev.ip,
        hostname: dev.hostname,
        custom_name: isGateway ? 'Default Gateway Router' : (existing ? existing.custom_name : null),
        vendor: dev.vendor,
        is_randomized_mac: dev.is_randomized_mac ? 1 : 0,
        trust_level: isGateway ? 'trusted' : (existing ? existing.trust_level : 'untrusted'),
        status: 'online'
      });

      if (upsertResult.isNew) {
        newDevices.push(upsertResult.device);
        const randomizedNote = dev.is_randomized_mac ? ' (Uses Private/Randomized MAC)' : '';
        const msg = `New device detected: ${dev.ip} (${upsertResult.device.vendor})${randomizedNote}`;

        const event = this.db.logEvent({
          event_type: 'DEVICE_NEW',
          severity: 'WARNING',
          device_id: upsertResult.device.id,
          mac_address: macKey,
          ip_address: dev.ip,
          message: msg
        });
        alerts.push(event);

        if (this.notifier) {
          this.notifier.notify(event);
        }
      } else {
        updatedDevices.push(upsertResult.device);

        // Check if IP address changed
        if (upsertResult.ipChanged) {
          const msg = `Device ${macKey} (${upsertResult.device.vendor}) IP changed: ${upsertResult.previousIp} -> ${dev.ip}`;
          const event = this.db.logEvent({
            event_type: 'IP_CHANGED',
            severity: 'INFO',
            device_id: upsertResult.device.id,
            mac_address: macKey,
            ip_address: dev.ip,
            message: msg
          });
          alerts.push(event);

          if (this.notifier) {
            this.notifier.notify(event);
          }
        }

        // Check if previously offline device returned
        if (existing && existing.status !== 'online') {
          if (!this.isThrottled(macKey, 'DEVICE_ONLINE')) {
            const msg = `Known device ${upsertResult.device.custom_name || macKey} is back online at ${dev.ip}`;
            const event = this.db.logEvent({
              event_type: 'DEVICE_ONLINE',
              severity: 'INFO',
              device_id: upsertResult.device.id,
              mac_address: macKey,
              ip_address: dev.ip,
              message: msg
            });
            alerts.push(event);

            if (this.notifier) {
              this.notifier.notify(event);
            }
          }
        }
      }
    }

    // Mark missing devices as unreachable
    const allDbDevices = this.db.getAllDevices();
    for (const dev of allDbDevices) {
      if (dev.status === 'online' && !seenMacs.includes(dev.mac_address)) {
        if (!this.isThrottled(dev.mac_address, 'DEVICE_OFFLINE')) {
          const msg = `Device ${dev.custom_name || dev.last_ip} (${dev.mac_address}) went offline / unreachable`;
          const event = this.db.logEvent({
            event_type: 'DEVICE_OFFLINE',
            severity: 'INFO',
            device_id: dev.id,
            mac_address: dev.mac_address,
            ip_address: dev.last_ip,
            message: msg
          });
          alerts.push(event);

          if (this.notifier) {
            this.notifier.notify(event);
          }
        }
      }
    }

    this.db.markDevicesUnreachable(seenMacs);

    return {
      newDevices,
      updatedDevices,
      alerts
    };
  }
}

module.exports = DeviceStateMachine;
