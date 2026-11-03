const test = require('node:test');
const assert = require('node:assert');
const NetworkDiagnostics = require('../src/core/diagnostics');

test('NetworkDiagnostics: ipToLong and longToIp conversions', () => {
  const ip = '192.168.31.98';
  const long = NetworkDiagnostics.ipToLong(ip);
  assert.strictEqual(typeof long, 'number');
  assert.strictEqual(NetworkDiagnostics.longToIp(long), ip);

  assert.strictEqual(NetworkDiagnostics.longToIp(0), '0.0.0.0');
  assert.strictEqual(NetworkDiagnostics.longToIp(4294967295), '255.255.255.255');
});

test('NetworkDiagnostics: netmaskToCidr prefix calculation', () => {
  assert.strictEqual(NetworkDiagnostics.netmaskToCidr('255.255.255.0'), 24);
  assert.strictEqual(NetworkDiagnostics.netmaskToCidr('255.255.254.0'), 23);
  assert.strictEqual(NetworkDiagnostics.netmaskToCidr('255.255.0.0'), 16);
  assert.strictEqual(NetworkDiagnostics.netmaskToCidr('255.255.255.240'), 28);
  assert.strictEqual(NetworkDiagnostics.netmaskToCidr('255.255.255.252'), 30);
});

test('NetworkDiagnostics: calculateSubnet for standard /24 home network', () => {
  const subnet = NetworkDiagnostics.calculateSubnet('192.168.31.98', '255.255.255.0');
  assert.strictEqual(subnet.networkAddress, '192.168.31.0');
  assert.strictEqual(subnet.broadcastAddress, '192.168.31.255');
  assert.strictEqual(subnet.firstUsableIp, '192.168.31.1');
  assert.strictEqual(subnet.lastUsableIp, '192.168.31.254');
  assert.strictEqual(subnet.totalHosts, 254);
  assert.strictEqual(subnet.cidr, 24);
});

test('NetworkDiagnostics: calculateSubnet for /28 small subnet', () => {
  const subnet = NetworkDiagnostics.calculateSubnet('10.0.0.5', '255.255.255.240');
  assert.strictEqual(subnet.networkAddress, '10.0.0.0');
  assert.strictEqual(subnet.broadcastAddress, '10.0.0.15');
  assert.strictEqual(subnet.firstUsableIp, '10.0.0.1');
  assert.strictEqual(subnet.lastUsableIp, '10.0.0.14');
  assert.strictEqual(subnet.totalHosts, 14);
  assert.strictEqual(subnet.cidr, 28);
});

test('NetworkDiagnostics: isIpInSubnet checks', () => {
  assert.strictEqual(NetworkDiagnostics.isIpInSubnet('192.168.31.1', '192.168.31.98', '255.255.255.0'), true);
  assert.strictEqual(NetworkDiagnostics.isIpInSubnet('192.168.31.254', '192.168.31.98', '255.255.255.0'), true);
  assert.strictEqual(NetworkDiagnostics.isIpInSubnet('192.168.1.1', '192.168.31.98', '255.255.255.0'), false);
  assert.strictEqual(NetworkDiagnostics.isIpInSubnet('8.8.8.8', '192.168.31.98', '255.255.255.0'), false);
});

test('NetworkDiagnostics: generateSubnetIps list', () => {
  const ips = NetworkDiagnostics.generateSubnetIps('192.168.1.5', '255.255.255.248'); // /29 -> 6 usable hosts
  assert.strictEqual(ips.length, 6);
  assert.deepStrictEqual(ips, [
    '192.168.1.1',
    '192.168.1.2',
    '192.168.1.3',
    '192.168.1.4',
    '192.168.1.5',
    '192.168.1.6'
  ]);
});

