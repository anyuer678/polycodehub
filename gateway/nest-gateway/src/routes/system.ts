import { Router } from 'express';
import axios from 'axios';
import { dbPool } from '../db';
import { redis } from '../redis';
import { checkMqHealth } from '../mq';
import { ok, fail, asyncHandler } from '../middleware';
import { requireAdmin } from '../middleware/auth';
import { config } from '../config';

const router = Router();

router.get('/health', asyncHandler(async (_req, res) => {
  try {
    await dbPool.query('SELECT 1');
  } catch {
    return fail(res, 503, 'database unavailable');
  }
  const redisOk = await redis.ping().then(() => true).catch(() => false);
  const mqOk = await checkMqHealth();
  if (!redisOk || !mqOk) {
    return fail(res, 503, 'service degraded', { redis: redisOk, rabbitmq: mqOk });
  }
  ok(res, { status: 'ok' });
}));

router.get('/system/status', requireAdmin, asyncHandler(async (_req, res) => {
  async function check(name: string, url: string) {
    try {
      const r = await axios.get(url, { timeout: 4000 });
      return { name, ok: true, status: r.status };
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      return { name, ok: false, status: e?.response?.status || 0 };
    }
  }

  const results = await Promise.all([
    check('gateway', `${config.selfUrl}/health`),
    check('auth', `${config.authUrl}/actuator/health`),
    check('judge', `${config.judgeUrl}/health`),
    check('rabbitmq', config.rabbitmqMgmtUrl)
  ]);

  ok(res, { items: results });
}));

export default router;
