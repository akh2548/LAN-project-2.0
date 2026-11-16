const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const AppServer = require('../src/server/app');
const DatabaseManager = require('../src/db/database');
const { createPlatformAdapter } = require('../src/core/platform');

test('AppServer: REST API handlers and responses', async () => {
  const db = new DatabaseManager(':memory:');
  const server = new AppServer({ database: db, platformAdapter: createPlatformAdapter() });
  await server.init();

  const mockInvoke = (method, urlPath, payload = null, cookie = null, remoteAddress = '127.0.0.1') => {
    return new Promise((resolve) => {
      const req = new EventEmitter();
      req.method = method;
      req.url = urlPath;
      req.headers = cookie ? { cookie } : {};
      req.socket = { remoteAddress };

      let statusCode = 200;
      let headers = {};
      let body = '';

      const res = {
        writeHead: (code, h) => { statusCode = code; headers = h; },
        setHeader: (k, v) => { headers[k] = v; },
        write: (chunk) => { body += chunk; },
        end: (chunk) => {
          if (chunk) body += chunk;
          resolve({ statusCode, headers, body });
        }
      };

      server.handleRequest(req, res).catch(err => {
        resolve({ statusCode: 500, body: err.message });
      });

      if (payload) {
        req.emit('data', JSON.stringify(payload));
      }
      req.emit('end');
    });
  };

  const setupStatus = await mockInvoke('GET', '/api/auth/status');
  assert.deepStrictEqual(JSON.parse(setupStatus.body), {
    setupComplete: false,
    authenticated: false
  });

  const protectedRes = await mockInvoke('GET', '/api/stats');
  assert.strictEqual(protectedRes.statusCode, 401);

  const dashboardRedirect = await mockInvoke('GET', '/');
  assert.strictEqual(dashboardRedirect.statusCode, 302);
  assert.strictEqual(dashboardRedirect.headers.Location, '/admin-setup.html');

  const remoteSetupRes = await mockInvoke('POST', '/api/auth/setup', {
    loginId: 'test-admin',
    password: 'a-strong-test-password'
  }, null, '192.168.1.25');
  assert.strictEqual(remoteSetupRes.statusCode, 403);

  const weakSetupRes = await mockInvoke('POST', '/api/auth/setup', {
    loginId: 'test-admin',
    password: 'short'
  });
  assert.strictEqual(weakSetupRes.statusCode, 400);

  const setupRes = await mockInvoke('POST', '/api/auth/setup', {
    loginId: 'test-admin',
    password: 'a-strong-test-password'
  });
  assert.strictEqual(setupRes.statusCode, 201);
  assert.match(setupRes.headers['Set-Cookie'], /HttpOnly/);
  assert.match(setupRes.headers['Set-Cookie'], /SameSite=Strict/);
  const storedAdmin = db.getAdminAccount();
  assert.strictEqual(storedAdmin.login_id, 'test-admin');
  assert.ok(storedAdmin.password_hash instanceof Uint8Array);
  assert.notStrictEqual(Buffer.from(storedAdmin.password_hash).toString(), 'a-strong-test-password');
  const sessionCookie = setupRes.headers['Set-Cookie'].split(';')[0];

  const duplicateSetupRes = await mockInvoke('POST', '/api/auth/setup', {
    loginId: 'another-admin',
    password: 'another-strong-test-password'
  });
  assert.strictEqual(duplicateSetupRes.statusCode, 409);

  const invalidLoginRes = await mockInvoke('POST', '/api/auth/login', {
    loginId: 'test-admin',
    password: 'incorrect-password'
  });
  assert.strictEqual(invalidLoginRes.statusCode, 401);

  const loginRes = await mockInvoke('POST', '/api/auth/login', {
    loginId: 'TEST-ADMIN',
    password: 'a-strong-test-password'
  });
  assert.strictEqual(loginRes.statusCode, 200);
  const loginCookie = loginRes.headers['Set-Cookie'].split(';')[0];

  // 1. /api/stats
  const statsRes = await mockInvoke('GET', '/api/stats', null, loginCookie);
  assert.strictEqual(statsRes.statusCode, 200);
  const stats = JSON.parse(statsRes.body);
  assert.strictEqual(stats.totalDevices, 0);

  // 2. /api/devices
  const devRes = await mockInvoke('GET', '/api/devices', null, loginCookie);
  assert.strictEqual(devRes.statusCode, 200);
  const devs = JSON.parse(devRes.body);
  assert.deepStrictEqual(devs, []);

  // 3. /api/router/info
  const routerRes = await mockInvoke('GET', '/api/router/info', null, loginCookie);
  assert.strictEqual(routerRes.statusCode, 200);
  const routerInfo = JSON.parse(routerRes.body);
  assert.strictEqual(typeof routerInfo.portalUrl, 'string');
  assert.ok(routerInfo.routerGuides.length > 0);

  // 4. /api/system/info
  const sysRes = await mockInvoke('GET', '/api/system/info', null, loginCookie);
  assert.strictEqual(sysRes.statusCode, 200);
  const sysInfo = JSON.parse(sysRes.body);
  assert.strictEqual(typeof sysInfo.platform, 'string');

  const logoutRes = await mockInvoke('POST', '/api/auth/logout', null, loginCookie);
  assert.strictEqual(logoutRes.statusCode, 200);
  const afterLogoutRes = await mockInvoke('GET', '/api/stats', null, loginCookie);
  assert.strictEqual(afterLogoutRes.statusCode, 401);

  db.close();
});
