const test = require('node:test');
const assert = require('node:assert');
const { normalizeMac, isRandomizedMac, lookupVendor } = require('../src/db/oui-data');

test('normalizeMac: standardizes delimiters and case', () => {
  assert.strictEqual(normalizeMac('28-2e-89-01-d4-2e'), '28:2E:89:01:D4:2E');
  assert.strictEqual(normalizeMac('28:2E:89:01:D4:2E'), '28:2E:89:01:D4:2E');
  assert.strictEqual(normalizeMac('282e8901d42e'), '28:2E:89:01:D4:2E');
  assert.strictEqual(normalizeMac('invalid-mac'), null);
  assert.strictEqual(normalizeMac(null), null);
  assert.strictEqual(normalizeMac(''), null);
});

test('isRandomizedMac: detects IEEE locally administered privacy addresses', () => {
  // Second hex digit with bit 1 set: 2, 6, A, E
  assert.strictEqual(isRandomizedMac('2A:2E:89:01:D4:2E'), true); // '2A': 'A' = 1010b -> bit 1 is 1
  assert.strictEqual(isRandomizedMac('02:00:00:00:00:00'), true);
  assert.strictEqual(isRandomizedMac('AE:11:22:33:44:55'), true);
  assert.strictEqual(isRandomizedMac('7E:AA:BB:CC:DD:EE'), true);

  // Hardware burned-in addresses (bit 1 is 0)
  assert.strictEqual(isRandomizedMac('28:2E:89:01:D4:2E'), false); // '28': '8' = 1000b -> bit 1 is 0
  assert.strictEqual(isRandomizedMac('F0:18:98:AA:BB:CC'), false); // 'F0': '0' = 0000b -> bit 1 is 0
  assert.strictEqual(isRandomizedMac('B8:27:EB:11:22:33'), false); // 'B8': '8' = 1000b -> bit 1 is 0
});

test('lookupVendor: identifies major manufacturers offline', () => {
  assert.strictEqual(lookupVendor('28:2E:89:01:D4:2E'), 'Realtek Semiconductor');
  assert.strictEqual(lookupVendor('F0:18:98:12:34:56'), 'Apple, Inc.');
  assert.strictEqual(lookupVendor('B8:27:EB:11:22:33'), 'Raspberry Pi Foundation');
  assert.strictEqual(lookupVendor('BCD074000000'), 'Espressif Inc.');
  assert.strictEqual(lookupVendor('64:64:4A:12:34:56'), 'Xiaomi Communications');

  // Randomized MAC should be labeled as privacy mode
  assert.strictEqual(lookupVendor('2A:2E:89:01:D4:2E'), 'Private / Randomized MAC (Privacy Mode)');

  // Unknown vendor
  assert.strictEqual(lookupVendor('98:76:54:32:10:00'), 'Unknown Vendor');
});

