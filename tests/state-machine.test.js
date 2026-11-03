const test = require('node:test');
const assert = require('node:assert');
const DatabaseManager = require('../src/db/database');
const DeviceStateMachine = require('../src/core/state-machine');

test('DeviceStateMachine: processes scan results, fires alerts and updates states', async () => {
  const db = new DatabaseManager(':memory:');
  const recordedAlerts = [];
  const mockNotifier = {
    notify: (event) => recordedAlerts.push(event)
  };

  const stateMachine = new DeviceStateMachine({
    database: db,
    notifier: mockNotifier,
    gatewayIp: '192.168.31.1'
  });

  // Cycle 1: Two devices discovered (Gateway + Host)
  const scanCycle1 = [
    {
      ip: '192.168.31.1',
      mac: '64:64:4A:12:34:56',
      hostname: 'miwifi.router',
      vendor: 'Xiaomi Communications',
      is_randomized_mac: false,
      status: 'online'
    },
    {
      ip: '192.168.31.98',
      mac: '28:2E:89:01:D4:2E',
      hostname: 'LAPTOP-NGOP926R',
      vendor: 'Realtek Semiconductor',
      is_randomized_mac: false,
      status: 'online'
    }
  ];

  const result1 = await stateMachine.processScanResults(scanCycle1);
  assert.strictEqual(result1.newDevices.length, 2);
  assert.strictEqual(result1.alerts.filter(a => a.event_type === 'DEVICE_NEW').length, 2);

  const gatewayDevice = db.getDeviceByMac('64:64:4A:12:34:56');
  assert.strictEqual(gatewayDevice.custom_name, 'Default Gateway Router');
  assert.strictEqual(gatewayDevice.trust_level, 'trusted');

  // Cycle 2: A 3rd device joins with a randomized MAC
  const scanCycle2 = [
    ...scanCycle1,
    {
      ip: '192.168.31.120',
      mac: '2A:2E:89:FE:DC:BA',
      hostname: null,
      vendor: 'Private / Randomized MAC (Privacy Mode)',
      is_randomized_mac: true,
      status: 'online'
    }
  ];

  const result2 = await stateMachine.processScanResults(scanCycle2);
  assert.strictEqual(result2.newDevices.length, 1);
  assert.strictEqual(result2.newDevices[0].mac_address, '2A:2E:89:FE:DC:BA');
  assert.strictEqual(result2.newDevices[0].is_randomized_mac, 1);
  assert.strictEqual(result2.newDevices[0].trust_level, 'untrusted');

  // Cycle 3: The 3rd device goes offline
  const result3 = await stateMachine.processScanResults(scanCycle1);
  assert.strictEqual(result3.newDevices.length, 0);

  const device3InDb = db.getDeviceByMac('2A:2E:89:FE:DC:BA');
  assert.strictEqual(device3InDb.status, 'unreachable');
  assert.strictEqual(result3.alerts.filter(a => a.event_type === 'DEVICE_OFFLINE').length, 1);

  // Cycle 4: Gateway MAC spoofing / mismatch simulation
  const rogueScan = [
    {
      ip: '192.168.31.1',
      mac: 'DE:AD:BE:EF:00:01', // Attacker spoofing gateway IP
      hostname: 'rogue-gateway',
      vendor: 'Unknown Vendor',
      is_randomized_mac: false,
      status: 'online'
    }
  ];

  const result4 = await stateMachine.processScanResults(rogueScan);
  const criticalGatewayAlerts = result4.alerts.filter(a => a.event_type === 'GATEWAY_MISMATCH');
  assert.strictEqual(criticalGatewayAlerts.length, 1);
  assert.strictEqual(criticalGatewayAlerts[0].severity, 'CRITICAL');

  db.close();
});

