const { execFile } = require('node:child_process');
const PlatformAdapter = require('./adapter');
const { normalizeMac } = require('../../db/oui-data');

class DarwinAdapter extends PlatformAdapter {
  execCmd(file, args, timeoutMs = 5000) {
    return new Promise((resolve) => {
      execFile(file, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', err });
      });
    });
  }

  async getNetworkInterfaces() {
    const routeRes = await this.execCmd('netstat', ['-rn', '-f', 'inet']);
    let defaultGateway = null;
    let defaultInterface = null;

    if (routeRes.ok) {
      // Find default route line: default 192.168.1.1 UGScg en0
      const match = routeRes.stdout.match(/^default\s+([0-9.]+)\s+\S+\s+(\w+)/m);
      if (match) {
        defaultGateway = match[1];
        defaultInterface = match[2];
      }
    }

    const ifconfigRes = await this.execCmd('ifconfig');
    if (ifconfigRes.ok) {
      return DarwinAdapter.parseIfconfig(ifconfigRes.stdout, defaultGateway, defaultInterface);
    }

    return [];
  }

  static parseIfconfig(output, defaultGateway = null, defaultInterface = null) {
    if (!output) return [];
    const sections = output.split(/^(?=[a-z0-9]+:)/m);
    const adapters = [];

    for (const sec of sections) {
      const nameMatch = sec.match(/^([a-z0-9]+):/);
      if (!nameMatch) continue;
      const ifname = nameMatch[1];
      if (ifname === 'lo0') continue;

      const inetMatch = sec.match(/inet\s+([0-9.]+)\s+netmask\s+0x([0-9a-fA-F]+)/);
      if (!inetMatch) continue;

      const ip = inetMatch[1];
      const hexMask = parseInt(inetMatch[2], 16);
      const netmask = [
        (hexMask >>> 24) & 0xFF,
        (hexMask >>> 16) & 0xFF,
        (hexMask >>> 8) & 0xFF,
        hexMask & 0xFF
      ].join('.');

      const etherMatch = sec.match(/ether\s+([0-9a-fA-F:]+)/);
      const mac = etherMatch ? normalizeMac(etherMatch[1]) : null;

      adapters.push({
        name: ifname,
        description: ifname,
        mac,
        ip,
        netmask,
        gateway: (ifname === defaultInterface) ? defaultGateway : null
      });
    }

    return adapters;
  }

  async getArpTable() {
    const arpRes = await this.execCmd('arp', ['-an']);
    if (arpRes.ok) {
      return DarwinAdapter.parseArp(arpRes.stdout);
    }
    return [];
  }

  static parseArp(output) {
    if (!output) return [];
    const lines = output.split('\n');
    const results = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      // Example: ? (192.168.1.1) at 64:64:4a:12:34:56 on en0 ifscope [ethernet]
      const match = line.match(/\(([0-9.]+)\)\s+at\s+([0-9a-fA-F:]+)\s+on\s+(\w+)/);
      if (match) {
        const ip = match[1];
        const rawMac = match[2];
        if (rawMac === '(incomplete)' || rawMac === 'ff:ff:ff:ff:ff:ff') continue;
        const normMac = normalizeMac(rawMac);
        if (normMac) {
          results.push({
            ip,
            mac: normMac,
            type: line.includes('permanent') ? 'static' : 'dynamic'
          });
        }
      }
    }
    return results;
  }

  async pingHost(ip, timeoutMs = 500) {
    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    const res = await this.execCmd('ping', ['-c', '1', '-t', String(timeoutSec), ip], timeoutMs + 1000);
    if (res.ok) {
      const match = res.stdout.match(/time=([0-9.]+)\s*ms/);
      return { alive: true, timeMs: match ? parseFloat(match[1]) : null };
    }
    return { alive: false, timeMs: null };
  }

  async showToast(title, message) {
    const script = `display notification "${message.replace(/"/g, '')}" with title "${title.replace(/"/g, '')}"`;
    await this.execCmd('osascript', ['-e', script], 2000);
  }
}

module.exports = DarwinAdapter;

