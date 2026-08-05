import { Router } from 'express';
import { dbPool } from '../db';
import { ok, asyncHandler } from '../middleware';
import { buildTodayResponse, buildHistory } from '../services/daily';
import { loadHomeModules, HOME_MODULES } from '../services/home';

const router = Router();

router.get('/announcements', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 5));
  const offset = (page - 1) * limit;
  const pinnedOnly = req.query.pinned === 'true' || req.query.pinned === '1';
  const category = typeof req.query.category === 'string' && req.query.category.trim()
    ? req.query.category.trim()
    : null;

  const where: string[] = ['a.is_active = TRUE', '(a.expires_at IS NULL OR a.expires_at > NOW())'];
  const params: unknown[] = [];
  if (pinnedOnly) {
    params.push(true);
    where.push(`a.pinned = $${params.length}`);
  }
  if (category) {
    params.push(category);
    where.push(`a.category = $${params.length}`);
  }
  const whereSql = where.join(' AND ');

  const list = await dbPool.query(
    `SELECT a.id, a.title, a.content, a.pinned, a.category, a.expires_at, a.created_at, a.updated_at,
            a.created_by, u.username AS creator_name
     FROM announcements a
     LEFT JOIN users u ON u.id = a.created_by
     WHERE ${whereSql}
     ORDER BY a.pinned DESC, a.updated_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  const count = await dbPool.query(
    `SELECT COUNT(*)::int AS total FROM announcements a WHERE ${whereSql}`,
    params
  );
  ok(res, { items: list.rows, total: count.rows[0].total });
}));

router.get('/daily-problem', asyncHandler(async (_req, res) => {
  const data = await buildTodayResponse();
  ok(res, data);
}));

router.get('/daily-problem/history', asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 14;
  const data = await buildHistory(limit);
  ok(res, data);
}));

router.get('/home-modules', asyncHandler(async (_req, res) => {
  const enabled = await loadHomeModules();
  ok(res, {
    modules: HOME_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      enabled: enabled[m.key] ?? m.defaultEnabled
    }))
  });
}));

export default router;
