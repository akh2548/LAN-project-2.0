const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const config = require('../config');
const SSEManager = require('./sse');
const RouterAdvisor = require('./router-advisor');
const NetworkDiagnostics = require('../core/diagnostics');
const DiscoveryEngine = require('../core/discovery');
const DeviceStateMachine = require('../core/state-machine');
const Notifier = require('../core/notifier');

class AppServer {
  constructor({ database, platformAdapter = null }) {
    this.db = database;
    this.adapter = platformAdapter;
    this.sse = new SSEManager();
    this.notifier = new Notifier({ platformAdapter: this.adapter, sseManager: this.sse });
    this.diagnostics = new NetworkDiagnostics(this.adapter);
    this.discovery = new DiscoveryEngine({ platformAdapter: this.adapter });
    this.stateMachine = new DeviceStateMachine({
      database: this.db,
      notifier: this.notifier,
      gatewayIp: null
    });

    this.server = null;
    this.cachedPreFlight = null;
    this.autoScanTimer = null;
  }

  async init() {
    try {
      this.cachedPreFlight = await this.diagnostics.runPreFlightCheck();
      if (this.cachedPreFlight.activeInterface && this.cachedPreFlight.activeInterface.gateway) {
        this.stateMachine.setGatewayIp(this.cachedPreFlight.activeInterface.gateway);
      }
    } catch (err) {
      console.warn('Initial pre-flight warning:', err.message);
    }

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    return this;
  }

  start(port = config.server.port, host = config.server.host) {
    return new Promise((resolve, reject) => {
      this.server.listen(port, host, () => {
        // Start background auto-scan if configured
        if (config.scanner.autoScanIntervalSeconds > 0) {
          this.startAutoScan(config.scanner.autoScanIntervalSeconds);
        }
        resolve({ port, host });
      });
      this.server.on('error', reject);
    });
  }

  stop() {
    if (this.autoScanTimer) {
      clearInterval(this.autoScanTimer);
      this.autoScanTimer = null;
    }
    this.discovery.stopScan();
    this.sse.close();
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }

  startAutoScan(intervalSeconds) {
    if (this.autoScanTimer) clearInterval(this.autoScanTimer);
    this.autoScanTimer = setInterval(async () => {
      if (!this.discovery.isScanning) {
        try {
          await this.triggerScan('scheduled');
        } catch (err) {
          console.warn('Background scan notice:', err.message);
        }
      }
    }, intervalSeconds * 1000);
    this.autoScanTimer.unref();
  }

  async triggerScan(triggerType = 'manual') {
    const sessionId = this.db.createScanSession({ trigger_type: triggerType });
    this.sse.broadcast('scan_started', { triggerType, sessionId, time: new Date().toISOString() });

    try {
      const scanResult = await this.discovery.runScan({
        onProgress: (prog) => {
          this.sse.broadcast('scan_progress', prog);
        }
      });

      const processed = await this.stateMachine.processScanResults(scanResult.devices);

      this.db.completeScanSession(sessionId, {
        hosts_scanned: scanResult.summary.scannedHosts,
        devices_found: scanResult.summary.devicesFound,
        duration_ms: scanResult.summary.durationMs
      });

      const completionData = {
        sessionId,
        summary: scanResult.summary,
        devicesFound: scanResult.summary.devicesFound,
        newDevicesCount: processed.newDevices.length,
        updatedDevicesCount: processed.updatedDevices.length,
        alertsCount: processed.alerts.length
      };

      this.sse.broadcast('scan_completed', completionData);
      return completionData;
    } catch (err) {
      this.sse.broadcast('scan_error', { message: err.message });
      throw err;
    }
  }

  readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) {
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(new Error('Invalid JSON format'));
        }
      });
    });
  }

  sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
  }

  async handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    try {
      // API Routes
      if (pathname === '/api/stream' && method === 'GET') {
        this.sse.handleRequest(req, res);
        return;
      }

      if (pathname === '/api/system/info' && method === 'GET') {
        const fresh = await this.diagnostics.runPreFlightCheck();
        this.cachedPreFlight = fresh;
        this.sendJson(res, 200, fresh);
        return;
      }

      if (pathname === '/api/devices' && method === 'GET') {
        const devices = this.db.getAllDevices();
        this.sendJson(res, 200, devices);
        return;
      }

      if (pathname.startsWith('/api/devices/') && method === 'GET') {
        const id = parseInt(pathname.split('/')[3], 10);
        const device = this.db.getDeviceById(id);
        if (!device) {
          this.sendJson(res, 404, { error: 'Device not found' });
        } else {
          this.sendJson(res, 200, device);
        }
        return;
      }

      if (pathname.startsWith('/api/devices/') && method === 'PATCH') {
        const id = parseInt(pathname.split('/')[3], 10);
        const body = await this.readJsonBody(req);
        const updated = this.db.updateDeviceCustomInfo(id, body);
        this.sse.broadcast('device_updated', updated);
        this.sendJson(res, 200, updated);
        return;
      }

      if (pathname === '/api/scan/start' && method === 'POST') {
        if (this.discovery.isScanning) {
          this.sendJson(res, 409, { error: 'Scan already in progress' });
          return;
        }
        // Run scan asynchronously and respond immediately
        this.triggerScan('manual').catch(() => {});
        this.sendJson(res, 202, { message: 'Scan started' });
        return;
      }

      if (pathname === '/api/scan/stop' && method === 'POST') {
        this.discovery.stopScan();
        this.sendJson(res, 200, { message: 'Scan stopped' });
        return;
      }

      if (pathname === '/api/scan/status' && method === 'GET') {
        this.sendJson(res, 200, { isScanning: this.discovery.isScanning });
        return;
      }

      if (pathname === '/api/events' && method === 'GET') {
        const limit = parseInt(parsedUrl.query.limit || '50', 10);
        const offset = parseInt(parsedUrl.query.offset || '0', 10);
        const type = parsedUrl.query.type || null;
        const events = this.db.getRecentEvents(limit, offset, type);
        this.sendJson(res, 200, events);
        return;
      }

      if (pathname.startsWith('/api/events/') && pathname.endsWith('/ack') && method === 'POST') {
        const id = parseInt(pathname.split('/')[3], 10);
        this.db.acknowledgeEvent(id);
        this.sendJson(res, 200, { success: true });
        return;
      }

      if (pathname === '/api/stats' && method === 'GET') {
        const stats = this.db.getStats();
        this.sendJson(res, 200, stats);
        return;
      }

      if (pathname === '/api/router/info' && method === 'GET') {
        const gw = (this.cachedPreFlight && this.cachedPreFlight.activeInterface)
          ? this.cachedPreFlight.activeInterface.gateway || '192.168.31.1'
          : '192.168.31.1';
        const guidance = RouterAdvisor.getGuidance(gw);
        this.sendJson(res, 200, guidance);
        return;
      }

      // Static Frontend Files
      let filePath = pathname === '/' ? '/index.html' : pathname;
      const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
      const fullPath = path.join(config.paths.public, safePath);

      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.json': 'application/json',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(fullPath).pipe(res);
        return;
      }

      // 404
      this.sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('API Error:', err);
      this.sendJson(res, 500, { error: err.message });
    }
  }
}

module.exports = AppServer;

