/**
 * Pure auth helper tests — no Express server.
 * Run: node --experimental-strip-types --no-warnings tests/auth-pure.test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  banKey,
  computeBanTtl,
  extractToken,
  getJwtExp,
  isAdmin,
  isBanActive,
} from '../src/middleware/auth-pure.ts';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function jwt(exp) {
  const payload = exp === undefined ? { uid: 1 } : { uid: 1, exp };
  return `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`;
}

// banKey
assert.equal(banKey(42), 'auth:ban:42');

// isAdmin
assert.equal(isAdmin({ role: 'admin' }), true);
assert.equal(isAdmin({ role: 'user' }), false);
assert.equal(isAdmin(null), false);
assert.equal(isAdmin({ role: 'teacher' }, 'admin'), false);

// computeBanTtl
const now = Date.UTC(2026, 0, 1);
assert.equal(computeBanTtl(null, now), null);
assert.equal(computeBanTtl(new Date(now - 5000).toISOString(), now), 0);
const ttl = computeBanTtl(new Date(now + 30000).toISOString(), now);
assert.ok(ttl >= 29 && ttl <= 30, `ttl=${ttl}`);

// isBanActive
assert.equal(isBanActive(false, null, now), false);
assert.equal(isBanActive(true, null, now), true);
assert.equal(isBanActive(true, new Date(now - 1).toISOString(), now), false);
assert.equal(isBanActive(true, new Date(now + 1).toISOString(), now), true);

// getJwtExp
assert.equal(getJwtExp(jwt(1893456000)), 1893456000);
assert.equal(getJwtExp(jwt()), null);
assert.equal(getJwtExp('not-a-jwt'), null);
assert.equal(getJwtExp('onlyonepart'), null);

// extractToken: cookie wins
assert.equal(extractToken({ token: 'cookie-jwt' }, 'Bearer header-jwt'), 'cookie-jwt');
assert.equal(extractToken({}, 'Bearer header-jwt'), 'header-jwt');
assert.equal(extractToken({}, 'Basic abc'), null);
assert.equal(extractToken(undefined, undefined), null);
assert.equal(extractToken({ token: '' }, 'Bearer header-jwt'), 'header-jwt');
assert.equal(extractToken({ token: 'x' }, 'Bearer header-jwt', 'other'), 'header-jwt');

// sha256 cache-key contract still used by constants (documented)
const h = createHash('sha256').update('tok').digest('hex');
assert.equal(h.length, 64);

console.log('auth-pure.test.mjs: all assertions passed');
