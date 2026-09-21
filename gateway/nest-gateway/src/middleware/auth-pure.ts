/**
 * Auth pure helpers — no Express/Redis/DB imports.
 * Extracted so unit tests can run without booting the gateway.
 * auth.ts re-exports these; do not duplicate logic here and in auth.ts.
 */

export type AuthUser = {
  id: number;
  email: string;
  username: string;
  role?: string;
  ver?: number;
  exp?: number | null;
};

export type BanInfo = {
  ban_reason: string | null;
  banned_until: string | null;
};

export function isAdmin(user: Pick<AuthUser, 'role'> | null | undefined, adminRole = 'admin'): boolean {
  return user?.role === adminRole;
}

export function banKey(userId: number): string {
  return `auth:ban:${userId}`;
}

/**
 * Redis TTL for banKey aligned with banned_until.
 * null = permanent ban; 0 = already expired.
 */
export function computeBanTtl(banned_until: string | null, nowMs: number = Date.now()): number | null {
  if (!banned_until) return null;
  const ms = new Date(banned_until).getTime() - nowMs;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 0;
  return Math.ceil(ms / 1000);
}

/** banned=true and (permanent or until in the future) */
export function isBanActive(
  banned: boolean,
  banned_until: string | null,
  nowMs: number = Date.now()
): boolean {
  if (!banned) return false;
  if (!banned_until) return true;
  const until = new Date(banned_until).getTime();
  if (Number.isNaN(until)) return true; // treat malformed as still banned (fail-closed)
  return until > nowMs;
}

/**
 * Decode JWT payload exp without signature verification.
 * Cache-hit path only — full verify is auth-service.
 */
export function getJwtExp(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof json?.exp === 'number' && Number.isFinite(json.exp) ? json.exp : null;
  } catch {
    return null;
  }
}

/** Extract token: httpOnly cookie first, then Authorization: Bearer. */
export function extractToken(
  cookies: Record<string, unknown> | undefined,
  authorization: string | undefined,
  authCookieName = 'token'
): string | null {
  const cookieToken = cookies?.[authCookieName];
  if (cookieToken && typeof cookieToken === 'string' && cookieToken.length > 0) return cookieToken;
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}
