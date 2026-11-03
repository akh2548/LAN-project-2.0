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

  const mockInvoke = (method, urlPath, payload = null) => {
    return new Promise((resolve) => {
      const req = new EventEmitter();
      req.method = method;
      req.url = urlPath;
      req.headers = {};

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

  // 1. /api/stats
  const statsRes = await mockInvoke('GET', '/api/stats');
  assert.strictEqual(statsRes.statusCode, 200);
  const stats = JSON.parse(statsRes.body);
  assert.strictEqual(stats.totalDevices, 0);

  // 2. /api/devices
  const devRes = await mockInvoke('GET', '/api/devices');
  assert.strictEqual(devRes.statusCode, 200);
  const devs = JSON.parse(devRes.body);
  assert.deepStrictEqual(devs, []);

  // 3. /api/router/info
  const routerRes = await mockInvoke('GET', '/api/router/info');
  assert.strictEqual(routerRes.statusCode, 200);
  const routerInfo = JSON.parse(routerRes.body);
  assert.strictEqual(typeof routerInfo.portalUrl, 'string');
  assert.ok(routerInfo.routerGuides.length > 0);

  // 4. /api/system/info
  const sysRes = await mockInvoke('GET', '/api/system/info');
  assert.strictEqual(sysRes.statusCode, 200);
  const sysInfo = JSON.parse(sysRes.body);
  assert.strictEqual(typeof sysInfo.platform, 'string');

  db.close();
});

