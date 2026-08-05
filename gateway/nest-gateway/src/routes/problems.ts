import { Router } from 'express';
import { dbPool } from '../db';
import { ok, asyncHandler, parseId, parsePagination, HttpError } from '../middleware';
import { DIFFICULTIES } from '../constants';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const search = typeof req.query.search === 'string' && req.query.search.trim()
    ? `%${req.query.search.trim()}%`
    : null;
  const difficulty = typeof req.query.difficulty === 'string' && DIFFICULTIES.includes(req.query.difficulty as never)
    ? req.query.difficulty
    : null;
  const tag = typeof req.query.tag === 'string' && req.query.tag.trim() ? req.query.tag.trim() : null;

  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (search) {
    values.push(search);
    clauses.push(`title ILIKE $${values.length}`);
  }
  if (difficulty) {
    values.push(difficulty);
    clauses.push(`difficulty = $${values.length}`);
  }
  if (tag) {
    values.push(tag);
    clauses.push(`$${values.length}::text = ANY(tags)`);
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await dbPool.query(`SELECT COUNT(*) FROM problems ${whereSql}`, values);
  const total = Number(countResult.rows[0].count);

  values.push(limit, offset);
  const result = await dbPool.query(
    `SELECT p.id, p.title, p.difficulty, p.description, p.tags,
            COUNT(s.id) FILTER (WHERE s.status = 'AC')::int AS ac_count,
            COUNT(s.id)::int AS submission_count
     FROM problems p
     LEFT JOIN submissions s ON s.problem_id = p.id
     ${whereSql}
     GROUP BY p.id
     ORDER BY p.id ASC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  const items = result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    difficulty: row.difficulty,
    description: row.description,
    tags: row.tags || [],
    ac_count: Number(row.ac_count),
    submission_count: Number(row.submission_count),
    ac_rate: Number(row.submission_count) > 0
      ? Math.round((Number(row.ac_count) / Number(row.submission_count)) * 100)
      : 0
  }));
  ok(res, { items, total, page, limit });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'problem');
  const problem = await dbPool.query(
    `SELECT p.id, p.title, p.difficulty, p.description, p.tags,
            COUNT(s.id) FILTER (WHERE s.status = 'AC')::int AS ac_count,
            COUNT(s.id)::int AS submission_count
     FROM problems p
     LEFT JOIN submissions s ON s.problem_id = p.id
     WHERE p.id = $1
     GROUP BY p.id`,
    [id]
  );
  if (problem.rows.length === 0) throw new HttpError(404, 'problem not found');
  const row = problem.rows[0];
  ok(res, {
    id: row.id,
    title: row.title,
    difficulty: row.difficulty,
    description: row.description,
    tags: row.tags || [],
    ac_count: Number(row.ac_count),
    submission_count: Number(row.submission_count),
    ac_rate: Number(row.submission_count) > 0
      ? Math.round((Number(row.ac_count) / Number(row.submission_count)) * 100)
      : 0
  });
}));

router.get('/:id/test-cases', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'problem');
  const result = await dbPool.query(
    `SELECT id, problem_id, input_data, expected_output, is_sample
     FROM test_cases
     WHERE problem_id = $1 AND is_sample = TRUE
     ORDER BY id ASC`,
    [id]
  );
  ok(res, { items: result.rows });
}));

router.get('/:id/solutions', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'problem');
  const problem = await dbPool.query('SELECT id FROM problems WHERE id = $1', [id]);
  if (problem.rows.length === 0) throw new HttpError(404, 'problem not found');
  const result = await dbPool.query(
    `SELECT s.id, s.user_id, u.username, s.title, s.content, s.created_at
     FROM solutions s JOIN users u ON u.id = s.user_id
     WHERE s.problem_id = $1 AND s.status = 'approved'
     ORDER BY s.id DESC`,
    [id]
  );
  ok(res, { items: result.rows });
}));

export default router;
