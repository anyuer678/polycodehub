import { NextFunction, Request, Response } from 'express';
import axios from 'axios';
import { redis } from '../redis';
import { dbPool } from '../db';
import { config } from '../config';
import { ROLE_ADMIN, ROLE_USER, REDIS_KEYS, AUTH_COOKIE } from '../constants';
import { HttpError } from './http';
import {
  type AuthUser,
  type BanInfo,
  banKey,
  computeBanTtl,
  extractToken,
  getJwtExp,
  isAdmin as isAdminPure,
  isBanActive,
} from './auth-pure';

export type { AuthUser, BanInfo };
// Pure helpers live in auth-pure.ts (unit-testable without Express/Redis/DB).
export { banKey, computeBanTtl, getJwtExp, isBanActive };

/** 账号被封禁时抛出的错误，detail 携带 reason/until 供前端展示 */
export class AccountBannedError extends HttpError {
  constructor(ban_reason: string | null, banned_until: string | null) {
    super(403, 'account banned', { ban_reason, banned_until });
    this.name = 'AccountBannedError';
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
    interface Locals {
      requestId?: string;
    }
  }
}

/** 从 Authorization 头或 httpOnly Cookie 中提取 token。
 *  Cookie 优先（httpOnly 防 XSS），Authorization 头保留以兼容旧客户端。 */
export function getBearerToken(req: Request, authorization?: string): string | null {
  return extractToken(
    req.cookies as Record<string, unknown> | undefined,
    authorization ?? req.headers.authorization,
    AUTH_COOKIE
  );
}

export function isAdmin(user: AuthUser): boolean {
  return isAdminPure(user, ROLE_ADMIN);
}

/** 删除某用户的所有 auth 缓存：admin 更新用户时调用。
 *  由于 cache key 是 token 的 sha256（无法反推 userId），
 *  这里通过版本号机制让缓存命中时自检失效。 */
export async function invalidateUserAuthCache(userId: number): Promise<void> {
  try {
    await redis.incr(REDIS_KEYS.authUserVersion(userId));
  } catch {
    // redis 不可用时非致命：缓存 TTL=300s 内自然过期
  }
}

/** 主动查询某用户的封禁信息；不做缓存以便及时反映 admin 操作。
 *  用于登录路径与 auth 中间件 cache miss 时拿到结构化 reason/until。 */
export async function getBanInfo(userId: number): Promise<{ banned: boolean } & BanInfo | null> {
  const result = await dbPool.query(
    'SELECT banned, ban_reason, banned_until FROM users WHERE id = $1',
    [userId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    banned: Boolean(row.banned),
    ban_reason: row.ban_reason ?? null,
    banned_until: row.banned_until ? new Date(row.banned_until).toISOString() : null
  };
}

export async function getAuthUser(req: Request, authorization?: string): Promise<AuthUser | null> {
  const token = getBearerToken(req, authorization);
  if (!token) return null;

  const cacheKey = REDIS_KEYS.authUser(token);
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as AuthUser;
      if (parsed?.id) {
        // 缓存命中先校验 JWT 是否过期：过期 token 不得在缓存窗口内继续放行。
        // 旧缓存无 exp 字段时现场解码当前 token 兜底；解码失败走全量校验。
        const exp = typeof parsed.exp === 'number' ? parsed.exp : getJwtExp(token);
        if (exp !== null && exp * 1000 <= Date.now()) {
          await redis.del(cacheKey).catch(() => undefined);
          return null;
        }
        // 检查 banKey
        const banned = await redis.exists(banKey(parsed.id));
        if (banned) {
          // banKey 命中：回查 DB 拿到结构化封禁信息并抛出 AccountBannedError
          // 这样前端能拿到 ban_reason / banned_until 显示具体原因
          const info = await getBanInfo(parsed.id);
          if (info && isBanActive(info.banned, info.banned_until)) {
            throw new AccountBannedError(info.ban_reason, info.banned_until);
          }
          // banned_until 已过期或 DB 显示未封禁：清理 stale banKey，继续放行
          await redis.del(banKey(parsed.id)).catch(() => undefined);
        }
        // 检查用户版本号：admin 更新用户 role/banned 后会 INCR 版本号，
        // 缓存的 ver 与当前 ver 不匹配则视为失效，回退到全量校验
        const currentVer = await redis.get(REDIS_KEYS.authUserVersion(parsed.id));
        const currentVerNum = currentVer ? Number(currentVer) : 0;
        if (parsed.ver === currentVerNum) {
          return parsed;
        }
        // 版本不匹配，删除旧缓存并回退
        await redis.del(cacheKey).catch(() => undefined);
      }
    }
  } catch (err) {
    if (err instanceof AccountBannedError) throw err;
    // redis unavailable, fall through to full verification
  }

  try {
    const response = await axios.get(`${config.authUrl}/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000
    });
    const claims = response.data?.claims;
    if (!claims?.uid) return null;

    const userId = Number(claims.uid);
    const result = await dbPool.query(
      'SELECT id, email, username, role, banned, ban_reason, banned_until FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    if (isBanActive(Boolean(row.banned), row.banned_until ? new Date(row.banned_until).toISOString() : null)) {
      // 仍在封禁期内：抛结构化错误，前端展示原因与解封时间
      throw new AccountBannedError(row.ban_reason ?? null, row.banned_until ? new Date(row.banned_until).toISOString() : null);
    }
    // 读取当前版本号（不存在则 0），写入缓存时一并存入，命中时比对
    let ver = 0;
    try {
      const verStr = await redis.get(REDIS_KEYS.authUserVersion(userId));
      ver = verStr ? Number(verStr) : 0;
    } catch {
      // redis 不可用时 ver=0，下次有 ver 时会被判失效，安全
    }
    const authUser: AuthUser = {
      id: Number(row.id),
      email: String(row.email || ''),
      username: String(row.username || ''),
      role: String(row.role || ROLE_USER),
      ver,
      exp: getJwtExp(token)
    };

    try {
      await redis.setEx(cacheKey, 300, JSON.stringify(authUser));
    } catch {
      // cache write failure is non-fatal
    }
    return authUser;
  } catch (err: unknown) {
    if (err instanceof AccountBannedError) throw err;
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 401) return null;
    throw new HttpError(503, 'auth service unavailable');
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  getAuthUser(req, req.headers.authorization)
    .then((user) => {
      if (!user) {
        console.warn(`[auth] 401 ${req.method} ${req.originalUrl}`);
        return next(new HttpError(401, 'unauthorized'));
      }
      req.user = user;
      next();
    })
    .catch(next);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (!req.user || !isAdmin(req.user)) return next(new HttpError(403, 'admin only'));
    next();
  });
}

export function requireRole(...roles: string[]) {
  return function roleGuard(req: Request, res: Response, next: NextFunction) {
    requireAuth(req, res, (err?: unknown) => {
      if (err) return next(err);
      if (!req.user || !req.user.role || !roles.includes(req.user.role)) {
        return next(new HttpError(403, `required role: ${roles.join('/')}`));
      }
      next();
    });
  };
}
