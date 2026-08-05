import { NextFunction, Request, Response } from 'express';
import { redis } from '../redis';
import { REDIS_KEYS } from '../constants';
import { fail } from './http';

interface RateLimitOptions {
  keyPrefix: string;
  max: number;
  windowSeconds?: number;
  message: string;
  /** Redis 不可用时是否放行（默认 true 保证可用性）；敏感端点应设 false 拒绝请求 */
  failOpen?: boolean;
}

export function createRateLimiter(options: RateLimitOptions) {
  const windowSeconds = options.windowSeconds || 60;
  return async function rateLimiter(req: Request, res: Response, next: NextFunction) {
    try {
      // 使用 req.ip：main.ts 已设置 trust proxy=1，Express 会按信任代理链
      // 解析真实客户端 IP，避免直接读 X-Forwarded-For 头被伪造绕过。
      const ip = req.ip || 'unknown';
      const key = `${options.keyPrefix}:${ip}`;
      // 原子 INCR + 首次设 TTL（Lua）：若拆成两条命令，incr 后进程中断会让
      // key 无 TTL 且计数永不衰减（该 IP 被永久 429）
      const count = Number(await redis.eval(
        `local c = redis.call('INCR', KEYS[1])
         if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         return c`,
        { keys: [key], arguments: [String(windowSeconds)] }
      ));
      if (count > options.max) {
        return fail(res, 429, options.message);
      }
      next();
    } catch (err) {
      if (options.failOpen === false) {
        console.error(`rate limiter (${options.keyPrefix}) unavailable, rejecting request:`, err);
        return fail(res, 503, 'service temporarily unavailable');
      }
      console.error(`rate limiter (${options.keyPrefix}) unavailable, allowing request:`, err);
      next();
    }
  };
}

export const rateLimiter = createRateLimiter({
  keyPrefix: 'rate',
  max: 400,
  message: 'too many requests, slow down'
});

export const authRateLimiter = createRateLimiter({
  keyPrefix: 'auth-rate',
  max: 30,
  message: 'too many attempts, try again later',
  failOpen: false // 认证端点安全优先：Redis 故障时拒绝而非放行
});

export { REDIS_KEYS };
