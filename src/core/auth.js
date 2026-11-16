const crypto = require('node:crypto');

class AuthManager {
  /**
   * Hashes a password using scrypt with a cryptographic salt.
   * @param {string} password 
   * @param {string|null} salt 
   * @returns {{ hash: string, salt: string }}
   */
  static hashPassword(password, salt = null) {
    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a non-empty string.');
    }
    const generatedSalt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, generatedSalt, 64).toString('hex');
    return { hash, salt: generatedSalt };
  }

  /**
   * Securely verifies a password against its stored hash and salt.
   * @param {string} password 
   * @param {string} storedHash 
   * @param {string} salt 
   * @returns {boolean}
   */
  static verifyPassword(password, storedHash, salt) {
    if (!password || !storedHash || !salt) return false;
    try {
      const computedHash = crypto.scryptSync(password, salt, 64).toString('hex');
      const storedBuf = Buffer.from(storedHash, 'hex');
      const compBuf = Buffer.from(computedHash, 'hex');
      if (storedBuf.length !== compBuf.length) return false;
      return crypto.timingSafeEqual(storedBuf, compBuf);
    } catch {
      return false;
    }
  }

  /**
   * Generates a cryptographically random session token.
   * @returns {string}
   */
  static generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Validates username requirements (alphanumeric + underscore/hyphen, 3-30 chars).
   * @param {string} username 
   * @returns {boolean}
   */
  static isValidUsername(username) {
    if (!username || typeof username !== 'string') return false;
    return /^[a-zA-Z0-9_\-\.]{3,30}$/.test(username.trim());
  }
}

module.exports = AuthManager;
