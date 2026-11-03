const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

class DatabaseManager {
  constructor(customDbPath = null) {
    this.dbPath = customDbPath || config.paths.db;
    this.db = null;
    this.init();
  }

  init() {
    // Ensure parent directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // In Node.js 22+, node:sqlite provides DatabaseSync
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(this.dbPath);

    // Enable WAL mode for concurrency and performance
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    this.createSchema();
  }

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mac_address TEXT UNIQUE NOT NULL,
        last_ip TEXT NOT NULL,
        hostname TEXT,
        custom_name TEXT,
        vendor TEXT,
        is_randomized_mac INTEGER DEFAULT 0,
        trust_level TEXT DEFAULT 'untrusted',
        status TEXT DEFAULT 'online',
        first_seen TEXT DEFAULT CURRENT_TIMESTAMP,
        last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_devices_mac ON devices(mac_address);
      CREATE INDEX IF NOT EXISTS idx_devices_last_ip ON devices(last_ip);
      CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

      CREATE TABLE IF NOT EXISTS device_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL,
        ip_address TEXT NOT NULL,
        recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS event_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        device_id INTEGER,
        mac_address TEXT,
        ip_address TEXT,
        message TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        acknowledged INTEGER DEFAULT 0,
        FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_created ON event_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_type ON event_logs(event_type);

      CREATE TABLE IF NOT EXISTS scan_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        hosts_scanned INTEGER DEFAULT 0,
        devices_found INTEGER DEFAULT 0,
        duration_ms INTEGER,
        trigger_type TEXT DEFAULT 'manual'
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // Devices
  getAllDevices() {
    const stmt = this.db.prepare(`
      SELECT * FROM devices 
      ORDER BY 
        CASE status WHEN 'online' THEN 1 WHEN 'unreachable' THEN 2 ELSE 3 END,
        last_seen DESC
    `);
    return stmt.all();
  }

  getDeviceByMac(mac) {
    const stmt = this.db.prepare('SELECT * FROM devices WHERE mac_address = ?');
    return stmt.get(mac) || null;
  }

  getDeviceByIp(ip) {
    const stmt = this.db.prepare('SELECT * FROM devices WHERE last_ip = ?');
    return stmt.get(ip) || null;
  }

  getDeviceById(id) {
    const stmt = this.db.prepare('SELECT * FROM devices WHERE id = ?');
    const device = stmt.get(id);
    if (!device) return null;

    const histStmt = this.db.prepare('SELECT ip_address, recorded_at FROM device_history WHERE device_id = ? ORDER BY recorded_at DESC LIMIT 20');
    device.history = histStmt.all(id);
    return device;
  }

  upsertDevice(data) {
    const existing = this.getDeviceByMac(data.mac_address);
    const nowIso = new Date().toISOString();

    if (!existing) {
      const insertStmt = this.db.prepare(`
        INSERT INTO devices (
          mac_address, last_ip, hostname, custom_name, vendor,
          is_randomized_mac, trust_level, status, first_seen, last_seen, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = insertStmt.run(
        data.mac_address,
        data.last_ip,
        data.hostname || null,
        data.custom_name || null,
        data.vendor || 'Unknown Vendor',
        data.is_randomized_mac ? 1 : 0,
        data.trust_level || 'untrusted',
        data.status || 'online',
        nowIso,
        nowIso,
        data.notes || null
      );

      const newId = Number(result.lastInsertRowid);
      this.recordDeviceHistory(newId, data.last_ip);
      return { isNew: true, device: this.getDeviceById(newId) };
    } else {
      // Check for IP address change
      const ipChanged = existing.last_ip !== data.last_ip;

      const updateStmt = this.db.prepare(`
        UPDATE devices SET
          last_ip = ?,
          hostname = COALESCE(?, hostname),
          vendor = CASE WHEN vendor = 'Unknown Vendor' AND ? IS NOT NULL THEN ? ELSE vendor END,
          status = ?,
          last_seen = ?
        WHERE id = ?
      `);

      updateStmt.run(
        data.last_ip,
        data.hostname || null,
        data.vendor || null,
        data.vendor || null,
        data.status || 'online',
        nowIso,
        existing.id
      );

      if (ipChanged) {
        this.recordDeviceHistory(existing.id, data.last_ip);
      }

      return {
        isNew: false,
        ipChanged,
        previousIp: existing.last_ip,
        device: this.getDeviceById(existing.id)
      };
    }
  }

  updateDeviceCustomInfo(id, fields) {
    const updates = [];
    const values = [];

    if (fields.custom_name !== undefined) {
      updates.push('custom_name = ?');
      values.push(fields.custom_name);
    }
    if (fields.trust_level !== undefined) {
      updates.push('trust_level = ?');
      values.push(fields.trust_level);
    }
    if (fields.notes !== undefined) {
      updates.push('notes = ?');
      values.push(fields.notes);
    }

    if (updates.length === 0) return this.getDeviceById(id);

    values.push(id);
    const sql = `UPDATE devices SET ${updates.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);
    return this.getDeviceById(id);
  }

  markDevicesUnreachable(seenMacs = []) {
    const nowIso = new Date().toISOString();
    if (seenMacs.length === 0) {
      this.db.prepare("UPDATE devices SET status = 'unreachable' WHERE status = 'online'").run();
      return;
    }

    const placeholders = seenMacs.map(() => '?').join(',');
    const sql = `
      UPDATE devices 
      SET status = 'unreachable' 
      WHERE status = 'online' AND mac_address NOT IN (${placeholders})
    `;
    this.db.prepare(sql).run(...seenMacs);
  }

  recordDeviceHistory(deviceId, ip) {
    this.db.prepare('INSERT INTO device_history (device_id, ip_address) VALUES (?, ?)').run(deviceId, ip);
  }

  // Events
  logEvent({ event_type, severity = 'INFO', device_id = null, mac_address = null, ip_address = null, message }) {
    const stmt = this.db.prepare(`
      INSERT INTO event_logs (event_type, severity, device_id, mac_address, ip_address, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const nowIso = new Date().toISOString();
    const result = stmt.run(event_type, severity, device_id, mac_address, ip_address, message, nowIso);
    return {
      id: Number(result.lastInsertRowid),
      event_type,
      severity,
      device_id,
      mac_address,
      ip_address,
      message,
      created_at: nowIso,
      acknowledged: 0
    };
  }

  getRecentEvents(limit = 100, offset = 0, eventType = null) {
    if (eventType) {
      const stmt = this.db.prepare(`
        SELECT * FROM event_logs 
        WHERE event_type = ? 
        ORDER BY id DESC 
        LIMIT ? OFFSET ?
      `);
      return stmt.all(eventType, limit, offset);
    }
    const stmt = this.db.prepare(`
      SELECT * FROM event_logs 
      ORDER BY id DESC 
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset);
  }

  acknowledgeEvent(id) {
    this.db.prepare('UPDATE event_logs SET acknowledged = 1 WHERE id = ?').run(id);
    return true;
  }

  // Scans
  createScanSession({ trigger_type = 'manual' } = {}) {
    const nowIso = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO scan_sessions (started_at, trigger_type) VALUES (?, ?)
    `);
    const result = stmt.run(nowIso, trigger_type);
    return Number(result.lastInsertRowid);
  }

  completeScanSession(id, { hosts_scanned, devices_found, duration_ms }) {
    const nowIso = new Date().toISOString();
    this.db.prepare(`
      UPDATE scan_sessions 
      SET completed_at = ?, hosts_scanned = ?, devices_found = ?, duration_ms = ?
      WHERE id = ?
    `).run(nowIso, hosts_scanned, devices_found, duration_ms, id);
  }

  // Settings
  getSetting(key, defaultValue = null) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  }

  setSetting(key, value) {
    this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, String(value));
  }

  getStats() {
    const totalDevices = this.db.prepare('SELECT COUNT(*) as count FROM devices').get().count;
    const onlineDevices = this.db.prepare("SELECT COUNT(*) as count FROM devices WHERE status = 'online'").get().count;
    const untrustedDevices = this.db.prepare("SELECT COUNT(*) as count FROM devices WHERE trust_level = 'untrusted' AND status = 'online'").get().count;
    const lastScan = this.db.prepare('SELECT * FROM scan_sessions ORDER BY id DESC LIMIT 1').get() || null;

    return {
      totalDevices,
      onlineDevices,
      untrustedDevices,
      lastScan
    };
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = DatabaseManager;
