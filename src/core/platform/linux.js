const { execFile } = require('node:child_process');
const fs = require('node:fs');
const PlatformAdapter = require('./adapter');
const { normalizeMac } = require('../../db/oui-data');

class LinuxAdapter extends PlatformAdapter {
  execCmd(file, args, timeoutMs = 5000) {
    return new Promise((resolve) => {
      execFile(file, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', err });
      });
    });
  }

  async getNetworkInterfaces() {
    const routeRes = await this.execCmd('ip', ['route', 'show', 'default']);
    let defaultGateway = null;
    let defaultInterface = null;

    if (routeRes.ok) {
      const match = routeRes.stdout.match(/default via ([0-9.]+) dev (\w+)/);
      if (match) {
        defaultGateway = match[1];
        defaultInterface = match[2];
      }
    }

    const addrRes = await this.execCmd('ip', ['-j', 'addr']);
    if (addrRes.ok) {
      try {
        const json = JSON.parse(addrRes.stdout);
        const results = [];
        for (const iface of json) {
          if (iface.operstate === 'DOWN' || iface.ifname === 'lo') continue;
          const inet4 = (iface.addr_info || []).find(a => a.family === 'inet');
          if (!inet4) continue;

          results.push({
            name: iface.ifname,
            description: iface.ifname,
            mac: normalizeMac(iface.address),
            ip: inet4.local,
            netmask: LinuxAdapter.prefixToNetmask(inet4.prefixlen),
            gateway: (iface.ifname === defaultInterface) ? defaultGateway : null
          });
        }
        return results;
      } catch {
        // Fallback to text parsing
      }
    }

    return [];
  }

  static prefixToNetmask(prefix) {
    const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
    return [
      (mask >>> 24) & 0xFF,
      (mask >>> 16) & 0xFF,
      (mask >>> 8) & 0xFF,
      mask & 0xFF
    ].join('.');
  }

  async getArpTable() {
    // Try /proc/net/arp first (fastest, direct file read)
    try {
      if (fs.existsSync('/proc/net/arp')) {
        const content = fs.readFileSync('/proc/net/arp', 'utf8');
        const parsed = LinuxAdapter.parseProcNetArp(content);
        if (parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback
    }

    const neighRes = await this.execCmd('ip', ['-j', 'neigh']);
    if (neighRes.ok) {
      try {
        const list = JSON.parse(neighRes.stdout);
        const results = [];
        for (const item of list) {
          if (!item.dst || !item.lladdr) continue;
          if (item.state && item.state.includes('FAILED')) continue;
          const normMac = normalizeMac(item.lladdr);
          if (normMac) {
            results.push({
              ip: item.dst,
              mac: normMac,
              type: item.state ? item.state.join(',').toLowerCase() : 'dynamic'
            });
          }
        }
        return results;
      } catch {
        // Fallback
      }
    }

    return [];
  }

  static parseProcNetArp(content) {
    if (!content) return [];
    const lines = content.split('\n');
    const results = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      // IP address, HW type, Flags, HW address, Mask, Device
      if (parts.length >= 4) {
        const ip = parts[0];
        const flags = parts[2];
        const rawMac = parts[3];
        // Flag 0x0 means incomplete
        if (flags === '0x0' || rawMac === '00:00:00:00:00:00') continue;
        const normMac = normalizeMac(rawMac);
        if (normMac) {
          results.push({
            ip,
            mac: normMac,
            type: flags === '0x2' ? 'dynamic' : 'static'
          });
        }
      }
    }
    return results;
  }

  async pingHost(ip, timeoutMs = 500) {
    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    const res = await this.execCmd('ping', ['-c', '1', '-W', String(timeoutSec), ip], timeoutMs + 1000);
    if (res.ok) {
      const match = res.stdout.match(/time=([0-9.]+)\s*ms/);
      return { alive: true, timeMs: match ? parseFloat(match[1]) : null };
    }
    return { alive: false, timeMs: null };
  }

  async showToast(title, message) {
    await this.execCmd('notify-send', ['-a', 'Smart LAN Security', title, message], 2000);
  }
}

module.exports = LinuxAdapter;

