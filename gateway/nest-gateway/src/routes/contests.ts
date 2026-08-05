import { Router } from 'express';
import { dbPool } from '../db';
import { ok, asyncHandler, parseId, HttpError } from '../middleware';

const router = Router();

function contestStatus(startTime: string, endTime: string): 'upcoming' | 'ongoing' | 'finished' {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (now < start) return 'upcoming';
  if (now > end) return 'finished';
  return 'ongoing';
}

router.get('/', asyncHandler(async (req, res) => {
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;
  const result = await dbPool.query(
    `SELECT c.id, c.name, c.description, c.start_time, c.end_time, c.created_at, c.created_by,
            u.username AS creator_name,
            (SELECT COUNT(*) FROM contest_problems cp WHERE cp.contest_id = c.id) AS problem_count
     FROM contests c
     LEFT JOIN users u ON u.id = c.created_by
     ORDER BY c.start_time DESC`
  );
  const items = result.rows.map((r) => ({ ...r, status: contestStatus(r.start_time, r.end_time) }))
    .filter((r) => (statusFilter ? r.status === statusFilter : true));
  ok(res, { items });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'contest');
  const contest = await dbPool.query(
    `SELECT c.*, u.username AS creator_name
     FROM contests c LEFT JOIN users u ON u.id = c.created_by
     WHERE c.id = $1`,
    [id]
  );
  if (contest.rows.length === 0) throw new HttpError(404, 'contest not found');
  const problems = await dbPool.query(
    `SELECT cp.sort_order, p.id, p.title, p.difficulty, p.tags
     FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
     WHERE cp.contest_id = $1 ORDER BY cp.sort_order`,
    [id]
  );
  ok(res, { ...contest.rows[0], status: contestStatus(contest.rows[0].start_time, contest.rows[0].end_time), problems: problems.rows });
}));

router.get('/:id/leaderboard', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'contest');
  const contest = await dbPool.query('SELECT id, start_time FROM contests WHERE id = $1', [id]);
  if (contest.rows.length === 0) throw new HttpError(404, 'contest not found');

  const result = await dbPool.query(
    `WITH ac_first AS (
       SELECT s.user_id, s.problem_id, MIN(s.created_at) AS first_ac
       FROM submissions s WHERE s.contest_id = $1 AND s.status = 'AC'
       GROUP BY s.user_id, s.problem_id
     )
     SELECT u.id, u.username,
            COUNT(*) AS ac_count,
            COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (af.first_ac - c.start_time)), 0)), 0) AS penalty_sec
     FROM ac_first af
     JOIN users u ON u.id = af.user_id
     CROSS JOIN contests c
     WHERE c.id = $1
     GROUP BY u.id, u.username, c.start_time
     ORDER BY ac_count DESC, penalty_sec ASC, u.username ASC`,
    [id]
  );
  const items = result.rows.map((r, index) => ({
    rank: index + 1,
    user_id: r.id,
    username: r.username,
    ac_count: Number(r.ac_count),
    penalty_sec: Number(r.penalty_sec),
    penalty_min: Math.round(Number(r.penalty_sec) / 60)
  }));
  ok(res, { items });
}));

export default router;
