const { execFile, spawn } = require('node:child_process');
const PlatformAdapter = require('./adapter');
const { normalizeMac } = require('../../db/oui-data');

class WindowsAdapter extends PlatformAdapter {
  /**
   * Executes a system command safely with a timeout.
   */
  execCmd(file, args, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, stdout: stdout || '', stderr: stderr || '', err });
        } else {
          resolve({ ok: true, stdout: stdout || '', stderr: stderr || '', err: null });
        }
      });
    });
  }

  /**
   * Retrieves active network adapters by parsing ipconfig /all and route print
   */
  async getNetworkInterfaces() {
    const ipconfigRes = await this.execCmd('ipconfig', ['/all']);
    const routeRes = await this.execCmd('route', ['print']);

    const defaultGatewayMap = WindowsAdapter.parseRoutePrint(routeRes.stdout);
    const adapters = WindowsAdapter.parseIpconfig(ipconfigRes.stdout, defaultGatewayMap);

    return adapters;
  }

  /**
   * Parses output of ipconfig /all
   * @param {string} output 
   * @param {Map<string, string>} defaultGatewayMap Map of interfaceIP -> gatewayIP
   */
  static parseIpconfig(output, defaultGatewayMap = new Map()) {
    if (!output || typeof output !== 'string') return [];

    const lines = output.split(/\r?\n/);
    const adapters = [];
    let currentAdapter = null;
    let lookingForGatewayIpv4 = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Check for adapter header (e.g. "Wireless LAN adapter Wi-Fi:" or "Ethernet adapter Ethernet:")
      if (/^(Wireless LAN adapter|Ethernet adapter)\s+(.+):$/i.test(line)) {
        const match = line.match(/^(Wireless LAN adapter|Ethernet adapter)\s+(.+):$/i);
        if (currentAdapter && currentAdapter.ip) {
          adapters.push(currentAdapter);
        }
        const isEthernetHeader = /^Ethernet/i.test(match[1]);
        currentAdapter = {
          type: match[1],
          name: match[2].trim(),
          mediaType: isEthernetHeader ? 'ethernet' : 'wifi',
          isWired: isEthernetHeader,
          description: '',
          mac: null,
          ip: null,
          netmask: null,
          gateway: null,
          dhcpServer: null,
          isDisconnected: false
        };
        continue;
      }

      if (!currentAdapter) continue;

      if (/Media State/i.test(line) && /Media disconnected/i.test(line)) {
        currentAdapter.isDisconnected = true;
      } else if (/Description[ .:]+(.+)$/i.test(line)) {
        currentAdapter.description = line.match(/Description[ .:]+(.+)$/i)[1].trim();
        if (/Ethernet|GBE|Gigabit|LAN|USB2\.0 Ethernet|Fast Ethernet|PCIe GBE/i.test(currentAdapter.description)) {
          currentAdapter.mediaType = 'ethernet';
          currentAdapter.isWired = true;
        } else if (/Wi-Fi|WiFi|Wireless|802\.11/i.test(currentAdapter.description)) {
          currentAdapter.mediaType = 'wifi';
          currentAdapter.isWired = false;
        }
      } else if (/Physical Address[^:]*:\s*([0-9A-Fa-f-]+)/i.test(line)) {
        currentAdapter.mac = normalizeMac(line.match(/Physical Address[^:]*:\s*([0-9A-Fa-f-]+)/i)[1]);
      } else if (/IPv4 Address[^:]*:\s*([0-9.]+)/i.test(line)) {
        currentAdapter.ip = line.match(/IPv4 Address[^:]*:\s*([0-9.]+)/i)[1].replace(/\(Preferred\)/, '').trim();
      } else if (/Subnet Mask[^:]*:\s*([0-9.]+)/i.test(line)) {
        currentAdapter.netmask = line.match(/Subnet Mask[^:]*:\s*([0-9.]+)/i)[1].trim();
      } else if (/Default Gateway/i.test(line)) {
        const gwMatch = line.match(/Default Gateway[^:]*:\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})/i);
        if (gwMatch) {
          currentAdapter.gateway = gwMatch[1].trim();
          lookingForGatewayIpv4 = false;
        } else {
          lookingForGatewayIpv4 = true;
        }
      } else if (lookingForGatewayIpv4 && /^\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s*$/.test(line)) {
        const nextGw = line.match(/^\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s*$/);
        if (nextGw) {
          currentAdapter.gateway = nextGw[1].trim();
          lookingForGatewayIpv4 = false;
        }
      } else if (/DHCP Server[^:]*:\s*([0-9.]+)/i.test(line)) {
        lookingForGatewayIpv4 = false;
        currentAdapter.dhcpServer = line.match(/DHCP Server[^:]*:\s*([0-9.]+)/i)[1].trim();
      }
    }

    if (currentAdapter && currentAdapter.ip) {
      adapters.push(currentAdapter);
    }

    // Attach gateways from routing table if missing in ipconfig
    for (const ad of adapters) {
      if ((!ad.gateway || ad.gateway === '.' || !/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(ad.gateway)) && ad.ip && defaultGatewayMap.has(ad.ip)) {
        ad.gateway = defaultGatewayMap.get(ad.ip);
      }
    }

    // Filter out disconnected or virtual adapters without IPs
    return adapters.filter(a => !a.isDisconnected && a.ip && a.ip !== '0.0.0.0');
  }

  /**
   * Parses route print output to find default gateways for interfaces
   * @param {string} output 
   * @returns {Map<string, string>}
   */
  static parseRoutePrint(output) {
    const gatewayMap = new Map();
    if (!output) return gatewayMap;

    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      // Look for active route to 0.0.0.0
      // Example: 0.0.0.0  0.0.0.0  192.168.31.1  192.168.31.98  50
      const match = line.trim().match(/^0\.0\.0\.0\s+0\.0\.0\.0\s+([0-9.]+)\s+([0-9.]+)/);
      if (match) {
        const gateway = match[1];
        const interfaceIp = match[2];
        if (gateway !== 'On-link' && !gatewayMap.has(interfaceIp)) {
          gatewayMap.set(interfaceIp, gateway);
        }
      }
    }
    return gatewayMap;
  }

  /**
   * Reads Windows ARP table via arp -a
   * @param {string|null} targetInterfaceIp Optional filter for specific interface IP
   * @returns {Promise<Array<{ip: string, mac: string, type: string}>>}
   */
  async getArpTable(targetInterfaceIp = null) {
    const arpRes = await this.execCmd('arp', ['-a']);
    if (arpRes.ok && arpRes.stdout) {
      const parsed = WindowsAdapter.parseArp(arpRes.stdout, targetInterfaceIp);
      if (parsed.length > 0) return parsed;
    }

    // Fallback: PowerShell Get-NetNeighbor
    const psRes = await this.execCmd('powershell', [
      '-NoProfile',
      '-Command',
      'Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.LinkLayerAddress } | Select-Object IPAddress, LinkLayerAddress, State | ConvertTo-Json -Compress'
    ], 3000);

    if (psRes.ok && psRes.stdout) {
      const psParsed = WindowsAdapter.parsePowerShellNeighbors(psRes.stdout);
      if (psParsed.length > 0) return psParsed;
    }

    return [];
  }

  /**
   * Parses arp -a output into normalized records
   * @param {string} output 
   * @param {string|null} targetInterfaceIp
   */
  static parseArp(output, targetInterfaceIp = null) {
    if (!output || typeof output !== 'string') return [];

    const lines = output.split(/\r?\n/);
    const results = [];
    const seenIps = new Set();
    let currentInterfaceIp = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Check for interface boundary: e.g. "Interface: 192.168.0.100 --- 0x15"
      const ifaceMatch = line.match(/^Interface:\s*([0-9.]+)/i);
      if (ifaceMatch) {
        currentInterfaceIp = ifaceMatch[1];
        continue;
      }

      // If filtering for a specific interface, skip lines belonging to other interfaces
      if (targetInterfaceIp && currentInterfaceIp && currentInterfaceIp !== targetInterfaceIp) {
        continue;
      }

      // Match pattern: 192.168.31.1   64-64-4a-12-34-56   dynamic
      const match = line.match(/^([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s+([0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2})\s+(\w+)/i);
      if (match) {
        const ip = match[1];
        const rawMac = match[2];
        const type = match[3].toLowerCase();

        // Filter out broadcast and multicast
        if (ip.startsWith('224.') || ip.startsWith('239.') || ip === '255.255.255.255' || ip.endsWith('.255')) {
          continue;
        }

        const normMac = normalizeMac(rawMac);
        if (normMac && !seenIps.has(ip)) {
          seenIps.add(ip);
          results.push({
            ip,
            mac: normMac,
            type: type === 'dynamic' ? 'dynamic' : 'static',
            interfaceIp: currentInterfaceIp
          });
        }
      }
    }

    return results;
  }

  /**
   * Parses JSON output from Get-NetNeighbor
   */
  static parsePowerShellNeighbors(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      const items = Array.isArray(data) ? data : [data];
      const results = [];
      for (const item of items) {
        if (!item || !item.IPAddress || !item.LinkLayerAddress) continue;
        const ip = item.IPAddress;
        if (ip.startsWith('224.') || ip.startsWith('239.') || ip === '255.255.255.255' || ip.endsWith('.255')) {
          continue;
        }
        const normMac = normalizeMac(item.LinkLayerAddress);
        if (normMac) {
          results.push({
            ip,
            mac: normMac,
            type: (item.State || 'dynamic').toLowerCase()
          });
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  /**
   * Performs an ICMP Echo ping using Windows ping.exe
   * @param {string} ip 
   * @param {number} timeoutMs 
   */
  async pingHost(ip, timeoutMs = 500) {
    const res = await this.execCmd('ping', ['-n', '1', '-w', String(timeoutMs), ip], timeoutMs + 1000);
    if (!res.ok) {
      return { alive: false, timeMs: null, err: res.stderr || 'Ping failed' };
    }

    // Check for "Reply from <ip>: bytes=32 time=4ms TTL=64"
    const match = res.stdout.match(/Reply from [0-9.]+: bytes=\d+ time[<=]([0-9]+)ms/i);
    if (match) {
      return { alive: true, timeMs: parseInt(match[1], 10), err: null };
    }
    return { alive: false, timeMs: null, err: null };
  }

  /**
   * Queries NetBIOS name table for Windows hosts
   * @param {string} ip 
   */
  async queryNetBios(ip) {
    const res = await this.execCmd('nbtstat', ['-A', ip], 2000);
    if (res.ok && res.stdout) {
      // Look for lines like:   COMPUTER-NAME  <00>  UNIQUE  Registered
      const match = res.stdout.match(/\s+([A-Z0-9_\-]+)\s+<00>\s+UNIQUE/i);
      if (match) {
        return match[1].trim();
      }
    }
    return null;
  }

  /**
   * Native desktop toast notification using PowerShell WinRT API
   */
  async showToast(title, message) {
    const safeTitle = title.replace(/['"`$]/g, '');
    const safeMsg = message.replace(/['"`$]/g, '');

    const script = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
      $template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02
      $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template)
      $textNodes = $xml.GetElementsByTagName('text')
      $textNodes.Item(0).AppendChild($xml.CreateTextNode('${safeTitle}')) > $null
      $textNodes.Item(1).AppendChild($xml.CreateTextNode('${safeMsg}')) > $null
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Smart LAN Security').Show($toast)
    `;

    try {
      await this.execCmd('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], 4000);
    } catch {
      // Silently ignore notification failure
    }
  }
}

module.exports = WindowsAdapter;

