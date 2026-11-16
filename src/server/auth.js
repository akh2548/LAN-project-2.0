const { promisify } = require('node:util');
const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');

const scryptAsync = promisify(scrypt);
const PASSWORD_BYTES = 64;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

class AuthManager {
  constructor(database) {
    this.db = database;
    this.sessions = new Map(); // token -> { expiresAt, user }
    this.failures = new Map(); // remoteAddress -> { count, startedAt }
  }

  isConfigured() {
    const admin = this.db.db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
    return Boolean(admin);
  }

  hasUsers() {
    return this.db.getUserCount() > 0;
  }

  async hashPassword(password, salt = null) {
    const s = salt || randomBytes(16).toString('hex');
    const hashBuffer = await scryptAsync(password, s, PASSWORD_BYTES, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 32 * 1024 * 1024
    });
    return { hash: hashBuffer.toString('hex'), salt: s };
  }

  async verifyPassword(password, storedHash, salt) {
    if (!password || !storedHash || !salt) return false;
    try {
      const candidateBuffer = await scryptAsync(
        typeof password === 'string' ? password.slice(0, 128) : '',
        salt,
        PASSWORD_BYTES,
        { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }
      );
      const storedBuffer = Buffer.from(storedHash, 'hex');
      if (candidateBuffer.length !== storedBuffer.length) return false;
      return timingSafeEqual(candidateBuffer, storedBuffer);
    } catch {
      return false;
    }
  }

  async createInitialAdmin(loginId, password) {
    if (typeof loginId !== 'string') {
      return { success: false, status: 400, error: 'Enter an administrator login ID.' };
    }
    const normalizedLoginId = loginId.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalizedLoginId)) {
      return { success: false, status: 400, error: 'Use 3–32 letters, numbers, dots, underscores, or hyphens for the login ID.' };
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return { success: false, status: 400, error: 'Choose a password of at least 8 characters.' };
    }
    if (this.isConfigured()) {
      return { success: false, status: 409, error: 'Administrator setup is already complete.' };
    }

    const { hash, salt } = await this.hashPassword(password);
    const user = this.db.createUser({
      username: normalizedLoginId,
      full_name: 'Administrator',
      password_hash: hash,
      password_salt: salt,
      role: 'admin'
    });

    return { success: true, user };
  }

  async registerUser({ username, email, full_name, password }) {
    const identifier = (email || username || '').trim().toLowerCase();
    if (!identifier || identifier.length < 3 || identifier.length > 80) {
      return { success: false, status: 400, error: 'Please enter a valid username or email (3–80 characters).' };
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return { success: false, status: 400, error: 'Password must be between 8 and 128 characters.' };
    }

    const existing = this.db.getUserByUsername(identifier);
    if (existing) {
      return { success: false, status: 409, error: 'An account with this username or email already exists.' };
    }

    // First registered user is automatically admin; subsequent users are standard users
    const isFirstUser = this.db.getUserCount() === 0;
    const role = isFirstUser ? 'admin' : 'user';

    const { hash, salt } = await this.hashPassword(password);
    const user = this.db.createUser({
      username: identifier,
      full_name: full_name ? full_name.trim() : (isFirstUser ? 'Administrator' : identifier),
      password_hash: hash,
      password_salt: salt,
      role
    });

    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(token, { expiresAt, user });
    this.db.createSession(user.id, token, 1);

    return { success: true, token, user };
  }

  async login(loginIdOrEmail, password, remoteAddress) {
    const failure = this.failures.get(remoteAddress);
    if (failure && failure.count >= MAX_FAILURES && Date.now() - failure.startedAt < FAILURE_WINDOW_MS) {
      return { success: false, status: 429, error: 'Too many sign-in attempts. Try again in 15 minutes.' };
    }

    const identifier = typeof loginIdOrEmail === 'string' ? loginIdOrEmail.trim().toLowerCase() : '';
    const user = this.db.getUserByUsername(identifier);

    if (!user) {
      this.recordFailure(remoteAddress);
      return { success: false, status: 401, error: 'Invalid login ID / email or password.' };
    }

    const passwordMatches = await this.verifyPassword(password, user.password_hash, user.password_salt);
    if (!passwordMatches) {
      this.recordFailure(remoteAddress);
      return { success: false, status: 401, error: 'Invalid login ID / email or password.' };
    }

    this.failures.delete(remoteAddress);
    this.db.updateUserLastLogin(user.id);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const safeUser = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
    };

    this.sessions.set(token, { expiresAt, user: safeUser });
    this.db.createSession(user.id, token, 1);

    return { success: true, token, user: safeUser };
  }

  recordFailure(remoteAddress) {
    const current = this.failures.get(remoteAddress);
    if (!current || Date.now() - current.startedAt >= FAILURE_WINDOW_MS) {
      this.failures.set(remoteAddress, { count: 1, startedAt: Date.now() });
    } else {
      current.count += 1;
    }
  }

  isSessionValid(token) {
    if (!token) return false;
    const session = this.sessions.get(token);
    if (session) {
      if (session.expiresAt <= Date.now()) {
        this.sessions.delete(token);
        this.db.deleteSession(token);
        return false;
      }
      return true;
    }

    // Fallback: check SQLite database
    const dbUser = this.db.getUserBySessionToken(token);
    if (dbUser) {
      this.sessions.set(token, {
        expiresAt: new Date(dbUser.expires_at).getTime(),
        user: {
          id: dbUser.id,
          username: dbUser.username,
          full_name: dbUser.full_name,
          role: dbUser.role
        }
      });
      return true;
    }

    return false;
  }

  getSessionUser(token) {
    if (!token) return null;
    if (this.isSessionValid(token)) {
      const session = this.sessions.get(token);
      return session ? session.user : null;
    }
    return null;
  }

  logout(token) {
    if (token) {
      this.sessions.delete(token);
      this.db.deleteSession(token);
    }
  }
}

module.exports = AuthManager;
