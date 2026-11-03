const test = require('node:test');
const assert = require('node:assert');
const DatabaseManager = require('../src/db/database');

test('DatabaseManager: CRUD, history, and events in memory database', () => {
  const db = new DatabaseManager(':memory:');

  // Initial stats
  const initialStats = db.getStats();
  assert.strictEqual(initialStats.totalDevices, 0);
  assert.strictEqual(initialStats.onlineDevices, 0);

  // Upsert new device
  const insert1 = db.upsertDevice({
    mac_address: '28:2E:89:01:D4:2E',
    last_ip: '192.168.31.98',
    hostname: 'LAPTOP-TEST',
    custom_name: 'Work Laptop',
    vendor: 'Realtek Semiconductor',
    is_randomized_mac: 0,
    trust_level: 'trusted',
    status: 'online'
  });

  assert.strictEqual(insert1.isNew, true);
  assert.strictEqual(insert1.device.mac_address, '28:2E:89:01:D4:2E');
  assert.strictEqual(insert1.device.last_ip, '192.168.31.98');

  // Verify history recorded
  const devWithHistory = db.getDeviceById(insert1.device.id);
  assert.strictEqual(devWithHistory.history.length, 1);
  assert.strictEqual(devWithHistory.history[0].ip_address, '192.168.31.98');

  // Upsert again with IP change
  const update1 = db.upsertDevice({
    mac_address: '28:2E:89:01:D4:2E',
    last_ip: '192.168.31.150',
    hostname: 'LAPTOP-TEST',
    vendor: 'Realtek Semiconductor',
    status: 'online'
  });

  assert.strictEqual(update1.isNew, false);
  assert.strictEqual(update1.ipChanged, true);
  assert.strictEqual(update1.previousIp, '192.168.31.98');
  assert.strictEqual(update1.device.last_ip, '192.168.31.150');

  // Verify history updated
  const devUpdated = db.getDeviceById(insert1.device.id);
  assert.strictEqual(devUpdated.history.length, 2);

  // Update custom fields
  const updatedCustom = db.updateDeviceCustomInfo(insert1.device.id, {
    custom_name: 'Renamed Laptop',
    trust_level: 'familiar',
    notes: 'Primary dev machine'
  });
  assert.strictEqual(updatedCustom.custom_name, 'Renamed Laptop');
  assert.strictEqual(updatedCustom.trust_level, 'familiar');
  assert.strictEqual(updatedCustom.notes, 'Primary dev machine');

  // Event logging
  const loggedEvent = db.logEvent({
    event_type: 'DEVICE_NEW',
    severity: 'WARNING',
    device_id: insert1.device.id,
    mac_address: '28:2E:89:01:D4:2E',
    ip_address: '192.168.31.150',
    message: 'New device detected'
  });
  assert.strictEqual(loggedEvent.event_type, 'DEVICE_NEW');
  assert.strictEqual(loggedEvent.acknowledged, 0);

  const events = db.getRecentEvents(10);
  assert.strictEqual(events.length, 1);

  db.acknowledgeEvent(loggedEvent.id);
  const ackedEvents = db.getRecentEvents(10);
  assert.strictEqual(ackedEvents[0].acknowledged, 1);

  // Test scan session
  const scanId = db.createScanSession({ trigger_type: 'manual' });
  assert.strictEqual(typeof scanId, 'number');
  db.completeScanSession(scanId, { hosts_scanned: 254, devices_found: 3, duration_ms: 5400 });

  const finalStats = db.getStats();
  assert.strictEqual(finalStats.totalDevices, 1);
  assert.strictEqual(finalStats.onlineDevices, 1);
  assert.strictEqual(finalStats.lastScan.hosts_scanned, 254);

  db.close();
});

