import { Router } from 'express';
import { dbPool } from '../db';
import { getMqChannel } from '../mq';
import { config } from '../config';
import { ok, asyncHandler, validateOrFail, HttpError, parseId } from '../middleware';
import { requireAuth } from '../middleware/auth';
import { writeAudit } from '../middleware/audit';
import { SubmitSchema, RunCodeSchema } from '../schemas';
import { AUDIT_ACTIONS } from '../constants';

const router = Router();

router.post('/submit', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const { problem_id, language, source_code, stdin } = validateOrFail(SubmitSchema, req.body);

  const mqChannel = getMqChannel();
  if (!mqChannel) throw new HttpError(503, 'judge queue unavailable');

  const problemCheck = await dbPool.query('SELECT id FROM problems WHERE id = $1', [problem_id]);
  if (problemCheck.rows.length === 0) throw new HttpError(404, 'problem not found');

  const contestResult = await dbPool.query(
    `SELECT cp.contest_id
     FROM contest_problems cp
     JOIN contests c ON c.id = cp.contest_id
     WHERE cp.problem_id = $1 AND NOW() BETWEEN c.start_time AND c.end_time
     ORDER BY c.id LIMIT 1`,
    [problem_id]
  );
  const contestId = contestResult.rows.length > 0 ? (contestResult.rows[0].contest_id as number) : null;

  const insert = await dbPool.query(
    `INSERT INTO submissions(user_id, problem_id, language, source_code, status, contest_id)
     VALUES ($1, $2, $3, $4, 'PENDING', $5) RETURNING id`,
    [user.id, problem_id, language, source_code, contestId]
  );

  const submissionId = insert.rows[0].id as number;
  try {
    mqChannel.sendToQueue(
      config.judgeQueue,
      Buffer.from(JSON.stringify({ submission_id: submissionId, user_id: user.id, problem_id, language, source_code, stdin: stdin || '' })),
      { persistent: true }
    );
  } catch (err) {
    await dbPool.query(
      `UPDATE submissions SET status = 'RE', error_message = $1, updated_at = NOW() WHERE id = $2`,
      ['failed to enqueue to judge queue', submissionId]
    );
    throw err;
  }

  await writeAudit(AUDIT_ACTIONS.SUBMISSION_ENQUEUE, user, 'submission', String(submissionId), { problem_id, language, contest_id: contestId });
  ok(res, { submission_id: submissionId, status: 'PENDING', contest_id: contestId }, 'queued');
}));

router.post('/run', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const { language, source_code, stdin } = validateOrFail(RunCodeSchema, req.body);

  const mqChannel = getMqChannel();
  if (!mqChannel) throw new HttpError(503, 'judge queue unavailable');

  const insert = await dbPool.query(
    `INSERT INTO runs(user_id, language, source_code, stdin, status)
     VALUES ($1, $2, $3, $4, 'PENDING') RETURNING id`,
    [user.id, language, source_code, stdin || '']
  );
  const runId = insert.rows[0].id as number;
  try {
    mqChannel.sendToQueue(
      config.judgeQueue,
      Buffer.from(JSON.stringify({ mode: 'run', run_id: runId, user_id: user.id, language, source_code, stdin: stdin || '' })),
      { persistent: true }
    );
  } catch (err) {
    await dbPool.query(`UPDATE runs SET status = 'RE', stderr = $1, updated_at = NOW() WHERE id = $2`, ['failed to enqueue to judge queue', runId]);
    throw err;
  }

  await writeAudit(AUDIT_ACTIONS.RUN_SUBMIT, user, 'run', String(runId), { language });
  ok(res, { run_id: runId, status: 'PENDING' }, 'queued');
}));

router.get('/runs/:id', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'run');
  const result = await dbPool.query(
    `SELECT id, user_id, language, source_code, stdin, status, stdout, stderr, runtime_ms, created_at
     FROM runs WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'run not found');
  ok(res, result.rows[0]);
}));

export default router;
