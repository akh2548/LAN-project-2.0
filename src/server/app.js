const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const config = require('../config');
const AuthManager = require('./auth');
const SSEManager = require('./sse');
const RouterAdvisor = require('./router-advisor');
const NetworkDiagnostics = require('../core/diagnostics');
const DiscoveryEngine = require('../core/discovery');
const DeviceStateMachine = require('../core/state-machine');
const Notifier = require('../core/notifier');

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

class AppServer {
  constructor({ database, platformAdapter = null }) {
    this.db = database;
    this.auth = new AuthManager(this.db);
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

  sendJson(res, statusCode, data, headers = {}) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers
    });
    res.end(JSON.stringify(data));
  }

  getSessionToken(req) {
    const cookieHeader = req.headers && req.headers.cookie;
    if (!cookieHeader) return null;
    const sessionCookie = cookieHeader.split(';').map(value => value.trim())
      .find(value => value.startsWith('lan_monitor_session='));
    return sessionCookie ? sessionCookie.slice('lan_monitor_session='.length) : null;
  }

  sendAuthRedirect(res, location) {
    res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
    res.end();
  }

  async handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    try {
      const sessionToken = this.getSessionToken(req);
      const authenticated = this.auth.isSessionValid(sessionToken);
      const currentUser = this.auth.getSessionUser(sessionToken);

      if (pathname === '/api/auth/status' && method === 'GET') {
        const payload = {
          setupComplete: this.auth.isConfigured(),
          authenticated
        };
        if (currentUser) payload.user = currentUser;
        this.sendJson(res, 200, payload);
        return;
      }

      if (pathname === '/api/auth/setup' && method === 'POST') {
        if (!isLoopbackAddress(req.socket?.remoteAddress)) {
          this.sendJson(res, 403, { error: 'Administrator setup is available only from this computer.' });
          return;
        }
        const body = await this.readJsonBody(req);
        const result = await this.auth.createInitialAdmin(body.loginId, body.password);
        if (!result.success) {
          this.sendJson(res, result.status, { error: result.error });
          return;
        }
        const login = await this.auth.login(body.loginId, body.password, req.socket?.remoteAddress || 'local');
        const secure = req.socket?.encrypted ? '; Secure' : '';
        this.sendJson(res, 201, { success: true, user: login.user }, {
          'Set-Cookie': `lan_monitor_session=${login.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`
        });
        return;
      }

      if (pathname === '/api/auth/register' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const result = await this.auth.registerUser({
          username: body.email || body.username || body.loginId,
          email: body.email || body.username,
          full_name: body.name || body.fullName || body.full_name,
          password: body.password
        });
        if (!result.success) {
          this.sendJson(res, result.status, { error: result.error });
          return;
        }
        const secure = req.socket?.encrypted ? '; Secure' : '';
        this.sendJson(res, 201, { success: true, user: result.user }, {
          'Set-Cookie': `lan_monitor_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`
        });
        return;
      }

      if (pathname === '/api/auth/login' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const identifier = body.loginId || body.email || body.username;
        const result = await this.auth.login(
          identifier,
          body.password,
          req.socket?.remoteAddress || 'local'
        );
        if (!result.success) {
          this.sendJson(res, result.status, { error: result.error });
          return;
        }
        const secure = req.socket?.encrypted ? '; Secure' : '';
        this.sendJson(res, 200, { success: true, user: result.user }, {
          'Set-Cookie': `lan_monitor_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`
        });
        return;
      }

      if (pathname === '/api/auth/me' && method === 'GET') {
        if (!authenticated || !currentUser) {
          this.sendJson(res, 401, { error: 'Not authenticated' });
          return;
        }
        this.sendJson(res, 200, { user: currentUser });
        return;
      }

      if (pathname === '/api/users' && method === 'GET') {
        if (!authenticated || currentUser?.role !== 'admin') {
          this.sendJson(res, 403, { error: 'Administrator access required' });
          return;
        }
        const users = this.db.getAllUsers();
        this.sendJson(res, 200, users);
        return;
      }

      if (pathname.startsWith('/api/users/') && pathname.endsWith('/role') && method === 'PATCH') {
        if (!authenticated || currentUser?.role !== 'admin') {
          this.sendJson(res, 403, { error: 'Administrator access required' });
          return;
        }
        const id = parseInt(pathname.split('/')[3], 10);
        const body = await this.readJsonBody(req);
        if (!['admin', 'user'].includes(body.role)) {
          this.sendJson(res, 400, { error: 'Invalid role specified.' });
          return;
        }
        const updated = this.db.updateUserRole(id, body.role);
        this.sendJson(res, 200, updated);
        return;
      }

      if (pathname.startsWith('/api/users/') && method === 'DELETE') {
        if (!authenticated || currentUser?.role !== 'admin') {
          this.sendJson(res, 403, { error: 'Administrator access required' });
          return;
        }
        const id = parseInt(pathname.split('/')[3], 10);
        if (id === currentUser.id) {
          this.sendJson(res, 400, { error: 'You cannot delete your own account.' });
          return;
        }
        this.db.deleteUser(id);
        this.sendJson(res, 200, { success: true });
        return;
      }

      if (pathname === '/api/auth/logout' && method === 'POST') {
        this.auth.logout(sessionToken);
        this.sendJson(res, 200, { success: true }, {
          'Set-Cookie': 'lan_monitor_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
        });
        return;
      }

      const publicAuthPaths = new Set([
        '/admin-login.html',
        '/admin-setup.html',
        '/login.html',
        '/register.html',
        '/auth.css',
        '/auth.js'
      ]);

      if (pathname.startsWith('/api/') && !authenticated) {
        this.sendJson(res, 401, { error: 'Authentication required' });
        return;
      }

      if (!pathname.startsWith('/api/') && !publicAuthPaths.has(pathname) && !authenticated) {
        this.sendAuthRedirect(res, this.auth.isConfigured() ? '/admin-login.html' : '/admin-setup.html');
        return;
      }

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

      if (method === 'OPTIONS') {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
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
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
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
