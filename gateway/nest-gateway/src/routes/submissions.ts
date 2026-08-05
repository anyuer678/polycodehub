import { Router } from 'express';
import crypto from 'crypto';
import { dbPool } from '../db';
import { ok, asyncHandler, parseId, parsePagination, HttpError, validateOrFail } from '../middleware';
import { requireAuth } from '../middleware/auth';
import { writeAudit } from '../middleware/audit';
import { AUDIT_ACTIONS, STATUSES, LANGUAGES } from '../constants';
import { z } from 'zod';

const ShareSchema = z.object({
  enabled: z.boolean()
});

const router = Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);

  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const language = typeof req.query.language === 'string' ? req.query.language : null;
  const problemIdRaw = typeof req.query.problem_id === 'string' ? Number(req.query.problem_id) : null;

  if (status && !STATUSES.includes(status as never)) throw new HttpError(400, 'invalid status');
  if (language && !LANGUAGES.includes(language as never)) throw new HttpError(400, 'invalid language');

  const clauses: string[] = ['s.user_id = $1'];
  const values: (string | number)[] = [user.id];

  if (status) {
    values.push(status);
    clauses.push(`s.status = $${values.length}`);
  }
  if (language) {
    values.push(language);
    clauses.push(`s.language = $${values.length}`);
  }
  if (problemIdRaw && Number.isInteger(problemIdRaw) && problemIdRaw > 0) {
    values.push(problemIdRaw);
    clauses.push(`s.problem_id = $${values.length}`);
  }

  const whereSql = clauses.join(' AND ');

  const countResult = await dbPool.query(
    `SELECT COUNT(*) FROM submissions s WHERE ${whereSql}`,
    values
  );
  const total = Number(countResult.rows[0].count);

  values.push(limit, offset);

  const result = await dbPool.query(
    `SELECT s.id, s.user_id, s.problem_id, p.title AS problem_title, s.language, s.status, s.runtime_ms, s.memory_kb,
            s.error_message, s.failed_case_input, s.expected_output, s.actual_output, s.created_at
     FROM submissions s
     JOIN problems p ON p.id = s.problem_id
     WHERE ${whereSql}
     ORDER BY s.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  ok(res, { items: result.rows, total, page, limit });
}));

router.get('/share/:token', asyncHandler(async (req, res) => {
  const token = req.params.token;
  const result = await dbPool.query(
    `SELECT s.id, s.user_id, u.username, s.problem_id, p.title AS problem_title, s.language, s.status,
            s.runtime_ms, s.memory_kb, s.error_message, s.failed_case_input, s.expected_output,
            s.actual_output, s.source_code, s.created_at
     FROM submissions s
     JOIN users u ON u.id = s.user_id
     JOIN problems p ON p.id = s.problem_id
     WHERE s.share_token = $1`,
    [token]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'share link not found or has been removed');
  ok(res, result.rows[0]);
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'submission');

  const result = await dbPool.query(
    `SELECT s.id, s.user_id, s.problem_id, p.title AS problem_title, s.language, s.status, s.runtime_ms, s.memory_kb, s.error_message,
            s.failed_case_input, s.expected_output, s.actual_output, s.created_at, s.updated_at, s.share_token
     FROM submissions s
     JOIN problems p ON p.id = s.problem_id
     WHERE s.id = $1 AND s.user_id = $2`,
    [id, user.id]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'submission not found');
  ok(res, result.rows[0]);
}));

router.put('/:id/share', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'submission');
  const { enabled } = validateOrFail(ShareSchema, req.body);

  const existing = await dbPool.query(
    `SELECT id, source_code FROM submissions WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  );
  if (existing.rows.length === 0) throw new HttpError(404, 'submission not found');

  let token: string | null = existing.rows[0].source_code && enabled
    ? crypto.randomBytes(12).toString('hex')
    : null;
  if (!enabled) token = null;

  const result = await dbPool.query(
    `UPDATE submissions SET share_token = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, share_token`,
    [token, id]
  );
  await writeAudit(AUDIT_ACTIONS.SUBMISSION_SHARE, user, 'submission', String(id), { enabled });
  ok(res, { shared: enabled, share_token: token }, enabled ? 'share link created' : 'share link removed');
}));

export default router;
