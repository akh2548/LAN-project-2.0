/**
 * Abstract Base Class for Platform Adapters
 */
class PlatformAdapter {
  constructor() {
    if (this.constructor === PlatformAdapter) {
      throw new Error('PlatformAdapter is an abstract class and cannot be instantiated directly.');
    }
  }

  /**
   * Retrieves active network adapter details.
   * @returns {Promise<Array<{name: string, description: string, mac: string, ip: string, netmask: string, gateway: string}>>}
   */
  async getNetworkInterfaces() {
    throw new Error('getNetworkInterfaces() must be implemented by subclass.');
  }

  /**
   * Reads the current operating system ARP/Neighbor table.
   * @returns {Promise<Array<{ip: string, mac: string, type: string}>>}
   */
  async getArpTable() {
    throw new Error('getArpTable() must be implemented by subclass.');
  }

  /**
   * Performs a single host ICMP ping.
   * @param {string} ip 
   * @param {number} timeoutMs 
   * @returns {Promise<{alive: boolean, timeMs: number|null}>}
   */
  async pingHost(ip, timeoutMs = 500) {
    throw new Error('pingHost() must be implemented by subclass.');
  }

  /**
   * Attempts NetBIOS name query.
   * @param {string} ip 
   * @returns {Promise<string|null>}
   */
  async queryNetBios(ip) {
    return null;
  }

  /**
   * Displays a native OS desktop notification.
   * @param {string} title 
   * @param {string} message 
   */
  async showToast(title, message) {
    // Default no-op
  }
}

module.exports = PlatformAdapter;

