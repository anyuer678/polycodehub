import { Router } from 'express';
import axios from 'axios';
import { config } from '../config';
import { ok, asyncHandler, validateOrFail, HttpError } from '../middleware';
import { authRateLimiter } from '../middleware/rateLimit';
import { getAuthUser, getBearerToken, getBanInfo, isBanActive, AccountBannedError } from '../middleware/auth';
import { RegisterSchema, LoginSchema } from '../schemas';
import { redis } from '../redis';
import { REDIS_KEYS, AUTH_COOKIE, AUTH_COOKIE_MAX_AGE_S, LOGIN_FAIL_MAX, LOGIN_FAIL_LOCK_S } from '../constants';

const router = Router();

router.use((req, _res, next) => {
  if (req.path === '/verify') return next();
  return authRateLimiter(req, _res, next);
});

/** 把 JWT 写入 httpOnly Cookie，前端不再持有 token 明文，防御 XSS 窃取 */
function setAuthCookie(res: import('express').Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: AUTH_COOKIE_MAX_AGE_S * 1000,
    path: '/'
  });
}

function clearAuthCookie(res: import('express').Response): void {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
}

/** 登录失败计数 + 账户锁定检查 */
async function checkLoginLock(email: string): Promise<void> {
  try {
    const count = await redis.get(REDIS_KEYS.loginFail(email));
    if (count && Number(count) >= LOGIN_FAIL_MAX) {
      throw new HttpError(429, 'too many failed attempts, try again later');
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // redis 不可用时放行，不阻断登录
  }
}

async function recordLoginFailure(email: string): Promise<void> {
  try {
    const key = REDIS_KEYS.loginFail(email);
    // 原子 INCR + 首次设 TTL：拆成两条命令时 incr 后中断会让 key 无 TTL、计数永不衰减
    await redis.eval(
      `local c = redis.call('INCR', KEYS[1])
       if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return c`,
      { keys: [key], arguments: [String(LOGIN_FAIL_LOCK_S)] }
    );
  } catch {
    // 非致命
  }
}

async function clearLoginFailures(email: string): Promise<void> {
  try {
    await redis.del(REDIS_KEYS.loginFail(email));
  } catch {
    // 非致命
  }
}

router.post('/register', asyncHandler(async (req, res) => {
  const data = validateOrFail(RegisterSchema, req.body);
  const response = await axios.post(`${config.authUrl}/auth/register`, data, { timeout: 5000 });
  const token = response.data?.token;
  if (token) setAuthCookie(res, token);
  ok(res, response.data, 'register success');
}));

router.post('/login', asyncHandler(async (req, res) => {
  const data = validateOrFail(LoginSchema, req.body);
  // 登录失败次数检查（防暴力破解）
  await checkLoginLock(data.email);
  try {
    const response = await axios.post(`${config.authUrl}/auth/login`, data, { timeout: 5000 });
    const token = response.data?.token;
    const userId: number | undefined = response.data?.user?.id;
    // 封号透明化：登录成功后立即检查封禁状态，让被封用户在登录阶段就看到原因
    // 而不是登录后第一次请求被 403 才发现
    if (userId) {
      const banInfo = await getBanInfo(userId);
      if (banInfo && isBanActive(banInfo.banned, banInfo.banned_until)) {
        // 已封禁：清除刚才下发的 Cookie，避免前端误以为已登录
        clearAuthCookie(res);
        throw new AccountBannedError(banInfo.ban_reason, banInfo.banned_until);
      }
    }
    if (token) {
      setAuthCookie(res, token);
      await clearLoginFailures(data.email);
    }
    ok(res, response.data, 'login success');
  } catch (err) {
    if (err instanceof AccountBannedError) throw err;
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 401) {
      // 记录失败次数
      await recordLoginFailure(data.email);
    }
    throw err;
  }
}));

router.post('/logout', asyncHandler(async (req, res) => {
  clearAuthCookie(res);
  // 删除该 token 的 auth 缓存键，登出立即生效（不再有最长 300s 的残留窗口）
  const token = getBearerToken(req, req.headers.authorization);
  if (token) {
    await redis.del(REDIS_KEYS.authUser(token)).catch(() => undefined);
  }
  ok(res, { loggedOut: true }, 'logout success');
}));

router.get('/verify', asyncHandler(async (req, res) => {
  const user = await getAuthUser(req, req.headers.authorization);
  if (!user) throw new HttpError(401, 'unauthorized');
  ok(res, user);
}));

export default router;
