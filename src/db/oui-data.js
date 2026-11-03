/**
 * Embedded OUI (Organizationally Unique Identifier) Vendor Dictionary & MAC Utilities
 * 
 * Works 100% offline without external API dependencies.
 */

// Top vendor prefixes (first 3 octets, uppercase without delimiters)
const OUI_DATABASE = {
  // Realtek
  '282E89': 'Realtek Semiconductor',
  '00E04C': 'Realtek Semiconductor',
  '54EE75': 'Realtek Semiconductor',
  '00E04D': 'Realtek Semiconductor',
  
  // Apple
  'F01898': 'Apple, Inc.',
  'ACDE48': 'Apple, Inc.',
  'BC926B': 'Apple, Inc.',
  '3CE072': 'Apple, Inc.',
  'A483E7': 'Apple, Inc.',
  '9027E4': 'Apple, Inc.',
  '7CD943': 'Apple, Inc.',
  '0017F2': 'Apple, Inc.',
  '001B63': 'Apple, Inc.',
  'DC2B61': 'Apple, Inc.',
  'F8FFC2': 'Apple, Inc.',
  
  // Samsung
  '0007AB': 'Samsung Electronics',
  '1449E0': 'Samsung Electronics',
  '342387': 'Samsung Electronics',
  '508569': 'Samsung Electronics',
  '90F1AA': 'Samsung Electronics',
  'AC5F3E': 'Samsung Electronics',
  'CC07AB': 'Samsung Electronics',
  
  // Intel
  '001302': 'Intel Corporate',
  '001500': 'Intel Corporate',
  '3413E8': 'Intel Corporate',
  '8086F2': 'Intel Corporate',
  'A44CC8': 'Intel Corporate',
  'D89C67': 'Intel Corporate',

  // Raspberry Pi Foundation
  'B827EB': 'Raspberry Pi Foundation',
  'DCA632': 'Raspberry Pi Foundation',
  'E45F01': 'Raspberry Pi Foundation',
  '28CDC1': 'Raspberry Pi Foundation',

  // Espressif (IoT, ESP8266, ESP32)
  '240AC4': 'Espressif Inc.',
  '30AEA4': 'Espressif Inc.',
  'BCD074': 'Espressif Inc.',
  'EC94CB': 'Espressif Inc.',
  '84CCA8': 'Espressif Inc.',

  // Xiaomi / Huami
  '64644A': 'Xiaomi Communications',
  '7C49EB': 'Xiaomi Communications',
  '04CF4B': 'Xiaomi Communications',
  '286C07': 'Xiaomi Communications',
  '50642B': 'Xiaomi Communications',
  'ACF1DF': 'Xiaomi Communications',

  // TP-Link
  '50C7BF': 'TP-Link Corporation',
  'E848B8': 'TP-Link Corporation',
  '000A3A': 'TP-Link Corporation',
  '14CC20': 'TP-Link Corporation',
  '74DA38': 'TP-Link Corporation',
  'C025E9': 'TP-Link Corporation',

  // Netgear
  '00146C': 'Netgear Inc.',
  '20E52A': 'Netgear Inc.',
  'A040A0': 'Netgear Inc.',
  'C0FFD4': 'Netgear Inc.',

  // Asus
  '04D9F5': 'ASUSTek Computer Inc.',
  '10BF48': 'ASUSTek Computer Inc.',
  '2CFDA1': 'ASUSTek Computer Inc.',
  '704D7B': 'ASUSTek Computer Inc.',

  // Google
  '30FD38': 'Google LLC',
  '48D705': 'Google LLC',
  '546009': 'Google LLC',
  'F4F5DB': 'Google LLC',
  'D86C63': 'Google LLC',

  // Amazon (Echo, FireTV, Kindle)
  '40B4CD': 'Amazon Technologies Inc.',
  '6854FD': 'Amazon Technologies Inc.',
  'FC65DE': 'Amazon Technologies Inc.',
  '44650D': 'Amazon Technologies Inc.',

  // Microsoft
  '00155D': 'Microsoft Corporation',
  '281878': 'Microsoft Corporation',
  'DCB4C4': 'Microsoft Corporation',
  '7CD30A': 'Microsoft Corporation',

  // Dell
  '14FEB5': 'Dell Inc.',
  '180373': 'Dell Inc.',
  '90B11C': 'Dell Inc.',
  'B82A72': 'Dell Inc.',

  // HP
  '0080A3': 'HP Inc.',
  '3C5282': 'HP Inc.',
  '84A938': 'HP Inc.',
  'A0D3C1': 'HP Inc.',

  // Sony / PlayStation
  '00041F': 'Sony Interactive Entertainment',
  'F8461C': 'Sony Interactive Entertainment',
  '001315': 'Sony Corporation',

  // Nintendo
  '001F32': 'Nintendo Co., Ltd.',
  '9C5CF9': 'Nintendo Co., Ltd.',
  'B87826': 'Nintendo Co., Ltd.'
};

/**
 * Standardizes a MAC address string to UPPERCASE colon-separated format (XX:XX:XX:XX:XX:XX)
 * @param {string} mac 
 * @returns {string|null}
 */
function normalizeMac(mac) {
  if (!mac || typeof mac !== 'string') return null;
  const cleaned = mac.trim().replace(/[:-]/g, '').toUpperCase();
  if (cleaned.length !== 12 || !/^[0-9A-F]{12}$/.test(cleaned)) {
    return null;
  }
  return cleaned.match(/.{1,2}/g).join(':');
}

/**
 * Checks whether a MAC address is locally administered (randomized for privacy).
 * In IEEE 802 addressing, the second-least-significant bit of the first octet is the U/L bit.
 * If 1, it is a Locally Administered Address (e.g. x2, x6, xA, xE).
 * @param {string} mac 
 * @returns {boolean}
 */
function isRandomizedMac(mac) {
  const normalized = normalizeMac(mac);
  if (!normalized) return false;
  const firstOctetHex = normalized.slice(0, 2);
  const firstOctetInt = parseInt(firstOctetHex, 16);
  // Bit 1 (0-indexed from right) is 0x02
  return (firstOctetInt & 0x02) !== 0;
}

/**
 * Looks up the hardware vendor for a given MAC address.
 * @param {string} mac 
 * @returns {string} Vendor name or 'Unknown Vendor' or 'Private / Randomized MAC'
 */
function lookupVendor(mac) {
  const normalized = normalizeMac(mac);
  if (!normalized) return 'Unavailable';
  
  if (isRandomizedMac(normalized)) {
    return 'Private / Randomized MAC (Privacy Mode)';
  }

  const prefix = normalized.replace(/:/g, '').slice(0, 6);
  if (OUI_DATABASE[prefix]) {
    return OUI_DATABASE[prefix];
  }
  return 'Unknown Vendor';
}

module.exports = {
  OUI_DATABASE,
  normalizeMac,
  isRandomizedMac,
  lookupVendor
};

