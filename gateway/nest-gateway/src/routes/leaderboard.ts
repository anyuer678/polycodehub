import { Router } from 'express';
import { dbPool } from '../db';
import { redis } from '../redis';
import { ok, asyncHandler, HttpError } from '../middleware';
import { PERIODS, REDIS_KEYS } from '../constants';

const TOP_N = 20;

const router = Router();

async function fillUsernames(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const uniqueIds = [...new Set(ids)].filter((x) => Number.isInteger(x) && x > 0);
  if (uniqueIds.length === 0) return map;
  const users = await dbPool.query('SELECT id, username FROM users WHERE id = ANY($1::bigint[])', [uniqueIds]);
  users.rows.forEach((u) => map.set(Number(u.id), String(u.username)));
  return map;
}

async function fillStats(ids: number[]): Promise<Map<number, { submission_count: number; pass_rate: number }>> {
  const map = new Map<number, { submission_count: number; pass_rate: number }>();
  const uniqueIds = [...new Set(ids)].filter((x) => Number.isInteger(x) && x > 0);
  if (uniqueIds.length === 0) return map;
  const result = await dbPool.query(
    `SELECT user_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'AC')::int AS ac
     FROM submissions
     WHERE user_id = ANY($1::bigint[])
     GROUP BY user_id`,
    [uniqueIds]
  );
  result.rows.forEach((r) => {
    const total = Number(r.total);
    const ac = Number(r.ac);
    map.set(Number(r.user_id), {
      submission_count: total,
      pass_rate: total > 0 ? Math.round((ac / total) * 100) : 0
    });
  });
  return map;
}

async function decorateItems<T extends { user_id: number; username: string }>(items: T[]): Promise<T[]> {
  const usersMap = await fillUsernames(items.map((x) => x.user_id));
  const statsMap = await fillStats(items.map((x) => x.user_id));
  items.forEach((item) => {
    item.username = usersMap.get(item.user_id) || `user-${item.user_id}`;
    const stats = statsMap.get(item.user_id);
    (item as T & { submission_count?: number; pass_rate?: number }).submission_count = stats?.submission_count ?? 0;
    (item as T & { submission_count?: number; pass_rate?: number }).pass_rate = stats?.pass_rate ?? 0;
  });
  return items;
}

router.get('/', asyncHandler(async (req, res) => {
  const period = String(req.query.period || 'all');
  if (!PERIODS.includes(period as never)) throw new HttpError(400, 'invalid period');

  const key = period === 'weekly' ? REDIS_KEYS.leaderboardWeekly() : period === 'monthly' ? REDIS_KEYS.leaderboardMonthly() : REDIS_KEYS.leaderboardAll;

  let top: { value: string; score: number }[] = [];
  try {
    top = await redis.zRangeWithScores(key, 0, TOP_N - 1, { REV: true });
  } catch (err) {
    console.error('leaderboard redis unavailable, falling back to db:', err);
    const result = await dbPool.query(
      `SELECT user_id, COUNT(*) AS ac_count
       FROM submissions
       WHERE status = 'AC'
       GROUP BY user_id
       ORDER BY ac_count DESC
       LIMIT $1`,
      [TOP_N]
    );
    const dbItems: { rank: number; user_id: number; ac_count: number; username: string }[] = result.rows.map((r, index) => ({
      rank: index + 1,
      user_id: Number(r.user_id),
      ac_count: Number(r.ac_count),
      username: ''
    }));
    await decorateItems(dbItems);
    return ok(res, { period, items: dbItems });
  }

  const items = top.map((entry, index) => ({
    rank: index + 1,
    user_id: Number(entry.value),
    username: '',
    ac_count: entry.score
  }));
  await decorateItems(items);

  ok(res, { period, items });
}));

export default router;
