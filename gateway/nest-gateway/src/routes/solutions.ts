import { Router } from 'express';
import { dbPool } from '../db';
import { ok, asyncHandler, validateOrFail, HttpError, parseId, parsePagination } from '../middleware';
import { requireAuth } from '../middleware/auth';
import { writeAudit } from '../middleware/audit';
import { CreateSolutionSchema, CreateCommentSchema } from '../schemas';
import { AUDIT_ACTIONS } from '../constants';

const router = Router();

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const { problem_id, title, content } = validateOrFail(CreateSolutionSchema, req.body);

  const problem = await dbPool.query('SELECT id FROM problems WHERE id = $1', [problem_id]);
  if (problem.rows.length === 0) throw new HttpError(404, 'problem not found');

  const solved = await dbPool.query(
    `SELECT 1 FROM submissions WHERE user_id = $1 AND problem_id = $2 AND status = 'AC' LIMIT 1`,
    [user.id, problem_id]
  );
  if (solved.rows.length === 0) throw new HttpError(403, 'you must solve this problem before posting a solution');

  const result = await dbPool.query(
    `INSERT INTO solutions(user_id, problem_id, title, content, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING id, title, status, created_at`,
    [user.id, problem_id, title, content]
  );
  await writeAudit(AUDIT_ACTIONS.SOLUTION_CREATE, user, 'solution', String(result.rows[0].id), { problem_id });
  ok(res, result.rows[0], 'solution submitted, awaiting review');
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const countResult = await dbPool.query(
    `SELECT COUNT(*) FROM solutions WHERE user_id = $1`,
    [user.id]
  );
  const total = Number(countResult.rows[0].count);
  const result = await dbPool.query(
    `SELECT s.id, s.problem_id, p.title AS problem_title, s.title, s.status, s.created_at, s.updated_at
     FROM solutions s JOIN problems p ON p.id = s.problem_id
     WHERE s.user_id = $1
     ORDER BY s.id DESC LIMIT $2 OFFSET $3`,
    [user.id, limit, offset]
  );
  ok(res, { items: result.rows, total, page, limit });
}));

// S4 修复：作者删除自己的题解。approved 状态也可删除（作者主权）。
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'solution');
  const result = await dbPool.query(
    'DELETE FROM solutions WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, user.id]
  );
  if (result.rows.length === 0) {
    // 区分"题解不存在"与"无权删除"：先查存在性
    const exists = await dbPool.query('SELECT id FROM solutions WHERE id = $1', [id]);
    if (exists.rows.length === 0) throw new HttpError(404, 'solution not found');
    throw new HttpError(403, 'you can only delete your own solution');
  }
  await writeAudit(AUDIT_ACTIONS.SOLUTION_CREATE, user, 'solution', String(id), { deleted: true });
  ok(res, { deleted: true, id }, 'solution deleted');
}));

router.get('/:id/comments', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'solution');
  const solution = await dbPool.query('SELECT id FROM solutions WHERE id = $1', [id]);
  if (solution.rows.length === 0) throw new HttpError(404, 'solution not found');
  const result = await dbPool.query(
    `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username
     FROM solution_comments c JOIN users u ON u.id = c.user_id
     WHERE c.solution_id = $1
     ORDER BY c.id ASC LIMIT 200`,
    [id]
  );
  ok(res, {
    items: result.rows.map((r) => ({
      id: r.id,
      content: r.content,
      user_id: r.user_id,
      username: r.username,
      created_at: new Date(r.created_at).toISOString()
    }))
  });
}));

router.post('/:id/comments', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'solution');
  const { content } = validateOrFail(CreateCommentSchema, req.body);
  const solution = await dbPool.query('SELECT id FROM solutions WHERE id = $1', [id]);
  if (solution.rows.length === 0) throw new HttpError(404, 'solution not found');
  const result = await dbPool.query(
    `INSERT INTO solution_comments(solution_id, user_id, content)
     VALUES ($1, $2, $3) RETURNING id, content, created_at`,
    [id, user.id, content]
  );
  ok(res, {
    id: result.rows[0].id,
    content: result.rows[0].content,
    user_id: user.id,
    username: user.username,
    created_at: new Date(result.rows[0].created_at).toISOString()
  }, 'comment posted');
}));

export default router;
