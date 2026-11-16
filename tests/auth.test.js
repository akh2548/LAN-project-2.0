const test = require('node:test');
const assert = require('node:assert');
const DatabaseManager = require('../src/db/database');
const AuthManager = require('../src/server/auth');

test('AuthManager: password hashing, user registration, login, and roles', async () => {
  const db = new DatabaseManager(':memory:');
  const auth = new AuthManager(db);

  // 1. Initial status - no users
  assert.strictEqual(auth.isConfigured(), false);
  assert.strictEqual(auth.hasUsers(), false);

  // 2. Register first user (automatically becomes admin)
  const reg1 = await auth.registerUser({
    name: 'Admin User',
    email: 'admin@local.lan',
    password: 'SuperSecretAdminPassword123'
  });
  assert.strictEqual(reg1.success, true);
  assert.strictEqual(reg1.user.role, 'admin');
  assert.strictEqual(reg1.user.username, 'admin@local.lan');
  assert.ok(reg1.token);
  assert.strictEqual(auth.isConfigured(), true);
  assert.strictEqual(auth.hasUsers(), true);

  // 3. Register second user (becomes standard user)
  const reg2 = await auth.registerUser({
    name: 'Standard User',
    email: 'user@local.lan',
    password: 'StandardUserPassword123'
  });
  assert.strictEqual(reg2.success, true);
  assert.strictEqual(reg2.user.role, 'user');
  assert.strictEqual(reg2.user.username, 'user@local.lan');

  // 4. Reject duplicate email/username
  const dup = await auth.registerUser({
    name: 'Duplicate',
    email: 'admin@local.lan',
    password: 'AnotherPassword123'
  });
  assert.strictEqual(dup.success, false);
  assert.strictEqual(dup.status, 409);

  // 5. Reject short password
  const shortPass = await auth.registerUser({
    name: 'Shorty',
    email: 'short@local.lan',
    password: '123'
  });
  assert.strictEqual(shortPass.success, false);
  assert.strictEqual(shortPass.status, 400);

  // 6. Login validation
  const loginSuccess = await auth.login('admin@local.lan', 'SuperSecretAdminPassword123', '127.0.0.1');
  assert.strictEqual(loginSuccess.success, true);
  assert.strictEqual(loginSuccess.user.role, 'admin');
  assert.ok(loginSuccess.token);

  const loginWrongPass = await auth.login('admin@local.lan', 'WrongPassword', '127.0.0.1');
  assert.strictEqual(loginWrongPass.success, false);
  assert.strictEqual(loginWrongPass.status, 401);

  const loginNotFound = await auth.login('nobody@local.lan', 'SomePassword123', '127.0.0.1');
  assert.strictEqual(loginNotFound.success, false);
  assert.strictEqual(loginNotFound.status, 401);

  // 7. Session verification
  assert.strictEqual(auth.isSessionValid(loginSuccess.token), true);
  const sessionUser = auth.getSessionUser(loginSuccess.token);
  assert.strictEqual(sessionUser.username, 'admin@local.lan');
  assert.strictEqual(sessionUser.role, 'admin');

  // 8. Role update and user deletion in DB
  const allUsers = db.getAllUsers();
  assert.strictEqual(allUsers.length, 2);

  const updatedUser = db.updateUserRole(reg2.user.id, 'admin');
  assert.strictEqual(updatedUser.role, 'admin');

  db.deleteUser(reg2.user.id);
  assert.strictEqual(db.getUserCount(), 1);

  // 9. Logout
  auth.logout(loginSuccess.token);
  assert.strictEqual(auth.isSessionValid(loginSuccess.token), false);

  db.close();
});
