import { Router } from 'express';
import { dbPool } from '../db';
import { ok, asyncHandler, parseId, parsePagination, HttpError } from '../middleware';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

// 未读数：前端小红点轮询用，轻量
router.get('/unread-count', asyncHandler(async (req, res) => {
  const result = await dbPool.query(
    'SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND is_read = FALSE',
    [req.user!.id]
  );
  ok(res, { unread: result.rows[0].unread });
}));

// 列表：分页 + unread_only 筛选，附带未读数
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const unreadOnly = req.query.unread_only === 'true' || req.query.unread_only === '1';

  const where: string[] = ['n.user_id = $1'];
  const params: unknown[] = [req.user!.id];
  if (unreadOnly) {
    params.push(true);
    where.push(`n.is_read = FALSE`);
  }
  const whereSql = where.join(' AND ');

  const list = await dbPool.query(
    `SELECT n.id, n.type, n.title, n.content, n.is_read, n.created_at, n.sender_id,
            u.username AS sender_name
     FROM notifications n
     LEFT JOIN users u ON u.id = n.sender_id
     WHERE ${whereSql}
     ORDER BY n.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  const count = await dbPool.query(
    `SELECT COUNT(*)::int AS total FROM notifications n WHERE ${whereSql}`,
    params
  );
  const unread = await dbPool.query(
    'SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND is_read = FALSE',
    [req.user!.id]
  );
  ok(res, { items: list.rows, total: count.rows[0].total, unread: unread.rows[0].unread, page, limit });
}));

// 全部标记已读
router.put('/read-all', asyncHandler(async (req, res) => {
  const result = await dbPool.query(
    'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE RETURNING id',
    [req.user!.id]
  );
  ok(res, { updated: result.rowCount ?? 0 }, 'all notifications marked as read');
}));

// 标记单条已读
router.put('/:id/read', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'notification');
  const result = await dbPool.query(
    'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id, is_read',
    [id, req.user!.id]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'notification not found');
  ok(res, result.rows[0], 'notification marked as read');
}));

export default router;
