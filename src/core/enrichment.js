const dns = require('node:dns').promises;
const { normalizeMac, isRandomizedMac, lookupVendor } = require('../db/oui-data');

class DeviceEnrichment {
  /**
   * Performs reverse DNS PTR lookup on an IP address.
   * @param {string} ip 
   * @param {number} timeoutMs 
   * @returns {Promise<string|null>}
   */
  static async resolveDnsHostname(ip, timeoutMs = 800) {
    try {
      const lookupPromise = dns.reverse(ip);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('DNS Timeout')), timeoutMs)
      );

      const hostnames = await Promise.race([lookupPromise, timeoutPromise]);
      if (Array.isArray(hostnames) && hostnames.length > 0) {
        return hostnames[0];
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Enriches raw device data with vendor, hostname, randomized MAC flags.
   * @param {object} params
   * @param {string} params.ip
   * @param {string} params.mac
   * @param {object} params.adapter PlatformAdapter instance
   */
  static async enrichDevice({ ip, mac, adapter = null }) {
    const normMac = normalizeMac(mac);
    const isRandomized = normMac ? isRandomizedMac(normMac) : false;
    const vendor = normMac ? lookupVendor(normMac) : 'Unavailable';

    let hostname = null;

    // 1. Try Reverse DNS PTR
    if (ip) {
      hostname = await DeviceEnrichment.resolveDnsHostname(ip, 600);
    }

    // 2. If no DNS hostname and adapter provides NetBIOS lookup, try NetBIOS
    if (!hostname && ip && adapter && typeof adapter.queryNetBios === 'function') {
      try {
        hostname = await adapter.queryNetBios(ip);
      } catch {
        hostname = null;
      }
    }

    return {
      ip,
      mac: normMac,
      hostname: hostname || null, // UI will display "(Unavailable / Blocked)" when null
      vendor,
      is_randomized_mac: isRandomized
    };
  }
}

module.exports = DeviceEnrichment;

