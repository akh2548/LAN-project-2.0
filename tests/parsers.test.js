const test = require('node:test');
const assert = require('node:assert');
const WindowsAdapter = require('../src/core/platform/windows');
const LinuxAdapter = require('../src/core/platform/linux');
const DarwinAdapter = require('../src/core/platform/darwin');

test('WindowsAdapter.parseIpconfig: parses live Windows ipconfig output fixture', () => {
  const fixture = `
Windows IP Configuration

   Host Name . . . . . . . . . . . . : LAPTOP-NGOP926R
   Primary Dns Suffix  . . . . . . . : 

Wireless LAN adapter Local Area Connection* 1:

   Media State . . . . . . . . . . . : Media disconnected
   Description . . . . . . . . . . . : Microsoft Wi-Fi Direct Virtual Adapter

Wireless LAN adapter Wi-Fi:

   Connection-specific DNS Suffix  . : 
   Description . . . . . . . . . . . : Realtek RTL8852BE-VS WiFi 6 802.11ax PCIe Adapter
   Physical Address. . . . . . . . . : 28-2E-89-01-D4-2E
   DHCP Enabled. . . . . . . . . . . : Yes
   IPv4 Address. . . . . . . . . . . : 192.168.31.98(Preferred) 
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.31.1
   DHCP Server . . . . . . . . . . . : 192.168.31.1
`;

  const adapters = WindowsAdapter.parseIpconfig(fixture);
  assert.strictEqual(adapters.length, 1);
  assert.strictEqual(adapters[0].name, 'Wi-Fi');
  assert.strictEqual(adapters[0].description, 'Realtek RTL8852BE-VS WiFi 6 802.11ax PCIe Adapter');
  assert.strictEqual(adapters[0].ip, '192.168.31.98');
  assert.strictEqual(adapters[0].netmask, '255.255.255.0');
  assert.strictEqual(adapters[0].gateway, '192.168.31.1');
  assert.strictEqual(adapters[0].mac, '28:2E:89:01:D4:2E');
});

test('WindowsAdapter.parseRoutePrint: extracts active default gateway', () => {
  const fixture = `
IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0     192.168.31.1    192.168.31.98     50
        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331
     192.168.31.0    255.255.255.0         On-link     192.168.31.98    306
`;

  const gatewayMap = WindowsAdapter.parseRoutePrint(fixture);
  assert.strictEqual(gatewayMap.get('192.168.31.98'), '192.168.31.1');
});

test('WindowsAdapter.parseArp: parses Windows arp -a table output', () => {
  const fixture = `
Interface: 192.168.31.98 --- 0x7
  Internet Address      Physical Address      Type
  192.168.31.1          64-64-4a-12-34-56     dynamic   
  192.168.31.105        b8-27-eb-aa-bb-cc     dynamic   
  192.168.31.255        ff-ff-ff-ff-ff-ff     static    
  224.0.0.22            01-00-5e-00-00-16     static    
`;

  const entries = WindowsAdapter.parseArp(fixture);
  assert.strictEqual(entries.length, 2);
  assert.deepStrictEqual(entries[0], {
    ip: '192.168.31.1',
    mac: '64:64:4A:12:34:56',
    type: 'dynamic'
  });
  assert.deepStrictEqual(entries[1], {
    ip: '192.168.31.105',
    mac: 'B8:27:EB:AA:BB:CC',
    type: 'dynamic'
  });
});

test('LinuxAdapter.parseProcNetArp: parses Linux /proc/net/arp', () => {
  const fixture = `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.1      0x1         0x2         00:14:6c:aa:bb:cc     *        eth0
192.168.1.50     0x1         0x2         f0:18:98:11:22:33     *        eth0
192.168.1.99     0x1         0x0         00:00:00:00:00:00     *        eth0
`;

  const entries = LinuxAdapter.parseProcNetArp(fixture);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].ip, '192.168.1.1');
  assert.strictEqual(entries[0].mac, '00:14:6C:AA:BB:CC');
  assert.strictEqual(entries[1].ip, '192.168.1.50');
  assert.strictEqual(entries[1].mac, 'F0:18:98:11:22:33');
});

test('DarwinAdapter.parseArp: parses macOS arp -an output', () => {
  const fixture = `? (192.168.1.1) at 64:64:4a:12:34:56 on en0 ifscope [ethernet]
? (192.168.1.20) at a4:83:e7:aa:bb:cc on en0 ifscope [ethernet]
? (192.168.1.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]
? (192.168.1.99) at (incomplete) on en0 ifscope [ethernet]
`;

  const entries = DarwinAdapter.parseArp(fixture);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].ip, '192.168.1.1');
  assert.strictEqual(entries[0].mac, '64:64:4A:12:34:56');
  assert.strictEqual(entries[1].ip, '192.168.1.20');
  assert.strictEqual(entries[1].mac, 'A4:83:E7:AA:BB:CC');
});

