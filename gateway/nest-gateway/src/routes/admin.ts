import { Router } from 'express';
import { dbPool } from '../db';
import { ok, asyncHandler, validateOrFail, parseId, parsePagination, HttpError } from '../middleware';
import { requireAdmin, requireRole } from '../middleware/auth';
import {
  CreateProblemSchema, UpdateProblemSchema, CreateTestCaseSchema, UpdateTestCaseSchema, BulkTestCaseSchema,
  BulkProblemSchema, UpdateUserSchema, CreateAnnouncementSchema, UpdateAnnouncementSchema, SetDailyProblemSchema,
  CreateContestSchema, UpdateContestSchema, ReviewSolutionSchema, SendNotificationSchema
} from '../schemas';
import { writeAudit } from '../middleware/audit';
import { AUDIT_ACTIONS, ROLE_ADMIN, ROLE_TEACHER, ROLE_USER } from '../constants';
import { getMqChannel } from '../mq';
import { config } from '../config';
import { redis } from '../redis';
import { banKey, invalidateUserAuthCache, computeBanTtl } from '../middleware/auth';
import { saveHomeModules } from '../services/home';

const router = Router();

router.use(requireRole(ROLE_ADMIN, ROLE_TEACHER));

async function assertCanEditProblem(problemId: number, user: { id: number; role?: string }) {
  if (user.role === ROLE_ADMIN) return;
  const result = await dbPool.query('SELECT created_by FROM problems WHERE id = $1', [problemId]);
  if (result.rows.length === 0) throw new HttpError(404, 'problem not found');
  if (Number(result.rows[0].created_by) !== user.id) throw new HttpError(403, '只能管理自己创建的题目');
}

async function assertCanEditContest(contestId: number, user: { id: number; role?: string }) {
  if (user.role === ROLE_ADMIN) return;
  const result = await dbPool.query('SELECT created_by FROM contests WHERE id = $1', [contestId]);
  if (result.rows.length === 0) throw new HttpError(404, 'contest not found');
  if (Number(result.rows[0].created_by) !== user.id) throw new HttpError(403, '只能管理自己创建的比赛');
}

router.get('/stats', requireAdmin, asyncHandler(async (_req, res) => {
  const [problems, users, submissions, statusDist, recent] = await Promise.all([
    dbPool.query('SELECT COUNT(*) AS total FROM problems'),
    dbPool.query('SELECT COUNT(*) AS total FROM users'),
    dbPool.query('SELECT COUNT(*) AS total FROM submissions'),
    dbPool.query(
      `SELECT status, COUNT(*) AS count FROM submissions GROUP BY status ORDER BY count DESC`
    ),
    dbPool.query(
      `SELECT s.id, s.status, s.language, u.username, p.title AS problem_title, s.created_at
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       JOIN problems p ON p.id = s.problem_id
       ORDER BY s.id DESC LIMIT 10`
    )
  ]);
  ok(res, {
    problems: Number(problems.rows[0].total),
    users: Number(users.rows[0].total),
    submissions: Number(submissions.rows[0].total),
    statusDistribution: statusDist.rows,
    recentSubmissions: recent.rows
  });
}));

router.post('/problems', asyncHandler(async (req, res) => {
  const user = req.user!;
  const { title, difficulty, description, tags } = validateOrFail(CreateProblemSchema, req.body);

  const result = await dbPool.query(
    `INSERT INTO problems(title, difficulty, description, tags, created_by) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, difficulty, description, tags, created_by, created_at`,
    [title, difficulty, description, tags || [], user.id]
  );
  await writeAudit(AUDIT_ACTIONS.PROBLEM_CREATE, user, 'problem', String(result.rows[0].id), { title, difficulty, tags });
  ok(res, result.rows[0], 'problem created');
}));

router.put('/problems/:id', asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'problem');
  const { title, difficulty, description, tags } = validateOrFail(UpdateProblemSchema, req.body);
  await assertCanEditProblem(id, user);

  const result = await dbPool.query(
    `UPDATE problems
     SET title = COALESCE($1, title), difficulty = COALESCE($2, difficulty),
         description = COALESCE($3, description), tags = COALESCE($4, tags), updated_at = NOW()
     WHERE id = $5
     RETURNING id, title, difficulty, description, tags, updated_at`,
    [title ?? null, difficulty ?? null, description ?? null, tags ?? null, id]
  );

  if (result.rows.length === 0) throw new HttpError(404, 'problem not found');
  await writeAudit(AUDIT_ACTIONS.PROBLEM_UPDATE, user, 'problem', String(id), { title, difficulty, tags });
  ok(res, result.rows[0], 'problem updated');
}));

router.delete('/problems/:id', asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'problem');
  await assertCanEditProblem(id, user);

  const result = await dbPool.query('DELETE FROM problems WHERE id = $1 RETURNING id', [id]);
  if (result.rows.length === 0) throw new HttpError(404, 'problem not found');
  await writeAudit(AUDIT_ACTIONS.PROBLEM_DELETE, user, 'problem', String(id), {});
  ok(res, { deleted: true, id }, 'problem deleted');
}));

router.post('/problems/:id/test-cases', asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'problem');
  const { input_data, expected_output, is_sample } = validateOrFail(CreateTestCaseSchema, req.body);

  const problemCheck = await dbPool.query('SELECT id FROM problems WHERE id = $1', [id]);
  if (problemCheck.rows.length === 0) throw new HttpError(404, 'problem not found');
  await assertCanEditProblem(id, user);

  const result = await dbPool.query(
    `INSERT INTO test_cases(problem_id, input_data, expected_output, is_sample)
     VALUES ($1, $2, $3, $4)
     RETURNING id, problem_id, input_data, expected_output, is_sample`,
    [id, input_data, expected_output, Boolean(is_sample)]
  );
  await writeAudit(AUDIT_ACTIONS.TESTCASE_CREATE, user, 'test_case', String(result.rows[0].id), { problem_id: id });
  ok(res, result.rows[0], 'test case created');
}));

router.post('/problems/:id/test-cases/bulk', asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'problem');
  const { items } = validateOrFail(BulkTestCaseSchema, req.body);

  const problemCheck = await dbPool.query('SELECT id FROM problems WHERE id = $1', [id]);
  if (problemCheck.rows.length === 0) throw new HttpError(404, 'problem not found');
  await assertCanEditProblem(id, user);

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const inserted: unknown[] = [];
    for (const it of items) {
      const row = await client.query(
        `INSERT INTO test_cases(problem_id, input_data, expected_output, is_sample)
         VALUES ($1, $2, $3, $4)
         RETURNING id, problem_id, input_data, expected_output, is_sample`,
        [id, it.input_data, it.expected_output, Boolean(it.is_sample)]
      );
      inserted.push(row.rows[0]);
    }
    await client.query('COMMIT');
    await writeAudit(AUDIT_ACTIONS.TESTCASE_BULK_CREATE, user, 'problem', String(id), { inserted: inserted.length });
    ok(res, { inserted_count: inserted.length, items: inserted }, 'bulk test cases created');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.put('/test-cases/:testCaseId', asyncHandler(async (req, res) => {
  const user = req.user!;
  const testCaseId = parseId(req.params.testCaseId, 'test case');
  const { input_data, expected_output, is_sample } = validateOrFail(UpdateTestCaseSchema, req.body);

  const owner = await dbPool.query('SELECT problem_id FROM test_cases WHERE id = $1', [testCaseId]);
  if (owner.rows.length === 0) throw new HttpError(404, 'test case not found');
  await assertCanEditProblem(Number(owner.rows[0].problem_id), user);

  const result = await dbPool.query(
    `UPDATE test_cases
     SET input_data = COALESCE($1, input_data), expected_output = COALESCE($2, expected_output), is_sample = COALESCE($3, is_sample)
     WHERE id = $4
     RETURNING id, problem_id, input_data, expected_output, is_sample`,
    [input_data ?? null, expected_output ?? null, typeof is_sample === 'boolean' ? is_sample : null, testCaseId]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'test case not found');
  await writeAudit(AUDIT_ACTIONS.TESTCASE_UPDATE, user, 'test_case', String(testCaseId), {});
  ok(res, result.rows[0], 'test case updated');
}));

router.delete('/test-cases/:testCaseId', asyncHandler(async (req, res) => {
  const user = req.user!;
  const testCaseId = parseId(req.params.testCaseId, 'test case');
  const owner = await dbPool.query('SELECT problem_id FROM test_cases WHERE id = $1', [testCaseId]);
  if (owner.rows.length === 0) throw new HttpError(404, 'test case not found');
  await assertCanEditProblem(Number(owner.rows[0].problem_id), user);

  const result = await dbPool.query('DELETE FROM test_cases WHERE id = $1 RETURNING id', [testCaseId]);
  if (result.rows.length === 0) throw new HttpError(404, 'test case not found');
  await writeAudit(AUDIT_ACTIONS.TESTCASE_DELETE, user, 'test_case', String(testCaseId), {});
  ok(res, { deleted: true, id: testCaseId }, 'test case deleted');
}));

router.post('/problems/bulk', asyncHandler(async (req, res) => {
  const user = req.user!;
  const { items } = validateOrFail(BulkProblemSchema, req.body);

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const insertedProblems: unknown[] = [];
    let insertedCases = 0;
    for (const it of items) {
      const problemRow = await client.query(
        `INSERT INTO problems(title, difficulty, description, tags, created_by) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, difficulty`,
        [it.title, it.difficulty, it.description, it.tags || [], user.id]
      );
      const problemId = problemRow.rows[0].id as number;
      insertedProblems.push(problemRow.rows[0]);
      for (const tc of it.test_cases) {
        await client.query(
          `INSERT INTO test_cases(problem_id, input_data, expected_output, is_sample)
           VALUES ($1, $2, $3, $4)`,
          [problemId, tc.input_data, tc.expected_output, Boolean(tc.is_sample)]
        );
        insertedCases += 1;
      }
    }
    await client.query('COMMIT');
    await writeAudit(AUDIT_ACTIONS.PROBLEM_BULK_CREATE, user, 'problem', 'bulk', {
      problems: insertedProblems.length, test_cases: insertedCases
    });
    ok(res, { inserted_count: insertedProblems.length, test_case_count: insertedCases, items: insertedProblems }, 'bulk problems created');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.get('/users', requireAdmin, asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const search = typeof req.query.search === 'string' && req.query.search.trim()
    ? `%${req.query.search.trim()}%`
    : null;
  const role = typeof req.query.role === 'string' && [ROLE_ADMIN, ROLE_TEACHER, ROLE_USER].includes(req.query.role)
    ? req.query.role
    : null;

  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (search) {
    values.push(search);
    clauses.push(`(u.username ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
  }
  if (role) {
    values.push(role);
    clauses.push(`u.role = $${values.length}`);
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await dbPool.query(`SELECT COUNT(*) FROM users u ${whereSql}`, values);
  const total = Number(countResult.rows[0].count);

  values.push(limit, offset);
  const result = await dbPool.query(
    `SELECT u.id, u.username, u.email, u.role, u.banned, u.ban_reason, u.banned_until, u.created_at,
            COUNT(s.id) AS submission_count,
            COUNT(s.id) FILTER (WHERE s.status = 'AC') AS ac_count
     FROM users u
     LEFT JOIN submissions s ON s.user_id = u.id
     ${whereSql}
     GROUP BY u.id
     ORDER BY u.id ASC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  ok(res, {
    items: result.rows.map((row) => ({
      ...row,
      submission_count: Number(row.submission_count),
      ac_count: Number(row.ac_count)
    })),
    total,
    page,
    limit
  });
}));

router.put('/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'user');
  const { role, banned, ban_reason, banned_until } = validateOrFail(UpdateUserSchema, req.body);

  if (id === user.id && (role === ROLE_USER || banned === true)) {
    throw new HttpError(400, 'cannot demote or ban yourself');
  }
  // ban_reason / banned_until 仅在封禁时才接受；解封时一并清空
  if (banned === false && (ban_reason !== undefined || banned_until !== undefined)) {
    throw new HttpError(400, 'cannot set ban_reason/banned_until when unban');
  }

  // S1 修复：防止管理员互封 / 锁死系统
  // 1) 禁止对 admin 用户执行 banned=true（防止管理员互封导致无人可恢复）
  // 2) 禁止把最后一个 admin 降级为 user（防止系统锁死）
  if (banned === true || role === ROLE_USER) {
    const target = await dbPool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (target.rows.length === 0) throw new HttpError(404, 'user not found');
    const targetRole = target.rows[0].role;
    if (targetRole === ROLE_ADMIN) {
      if (banned === true) {
        throw new HttpError(400, 'cannot ban admin user; demote to user first');
      }
      // role === ROLE_USER：准备降级 admin，校验是否最后一个 admin
      const adminCount = await dbPool.query(
        `SELECT COUNT(*)::int AS cnt FROM users WHERE role = 'admin' AND banned = FALSE`
      );
      if (Number(adminCount.rows[0].cnt) <= 1) {
        throw new HttpError(400, 'cannot demote the last active admin');
      }
    }
  }

  const result = await dbPool.query(
    `UPDATE users
     SET role = COALESCE($1, role),
         banned = COALESCE($2, banned),
         ban_reason = CASE WHEN COALESCE($2, banned) THEN $3 ELSE ban_reason END,
         banned_until = CASE WHEN COALESCE($2, banned) THEN $4 ELSE banned_until END
     WHERE id = $5
     RETURNING id, username, email, role, banned, ban_reason, banned_until`,
    [
      role ?? null,
      typeof banned === 'boolean' ? banned : null,
      ban_reason ?? null,
      banned_until ?? null,
      id
    ]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'user not found');

  if (banned === true) {
    // 限时封禁：banKey 设 TTL 与 banned_until 对齐，到期自动解除拦截
    const ttl = banned_until ? computeBanTtl(banned_until) : null;
    if (ttl && ttl > 0) {
      await redis.setEx(banKey(id), ttl, '1').catch(() => undefined);
    } else {
      // 永久封禁或 banned_until 已过期：不设 TTL，需 admin 显式解封
      await redis.set(banKey(id), '1').catch(() => undefined);
    }
  } else if (banned === false) {
    await redis.del(banKey(id)).catch(() => undefined);
  }
  // 失效该用户的 auth 缓存：role/banned 变更后立即生效，不再等 300s TTL
  await invalidateUserAuthCache(id);
  await writeAudit(AUDIT_ACTIONS.USER_UPDATE, user, 'user', String(id), { role, banned, ban_reason, banned_until });
  ok(res, result.rows[0], 'user updated');
}));

router.get('/submissions', requireAdmin, asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status : null;
  const username = typeof req.query.username === 'string' && req.query.username.trim() ? `%${req.query.username.trim()}%` : null;
  const problemTitle = typeof req.query.problem === 'string' && req.query.problem.trim() ? `%${req.query.problem.trim()}%` : null;

  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (status) {
    values.push(status);
    clauses.push(`s.status = $${values.length}`);
  }
  if (username) {
    values.push(username);
    clauses.push(`u.username ILIKE $${values.length}`);
  }
  if (problemTitle) {
    values.push(problemTitle);
    clauses.push(`p.title ILIKE $${values.length}`);
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await dbPool.query(
    `SELECT COUNT(*) FROM submissions s JOIN users u ON u.id = s.user_id JOIN problems p ON p.id = s.problem_id ${whereSql}`,
    values
  );
  const total = Number(countResult.rows[0].count);

  values.push(limit, offset);
  const result = await dbPool.query(
    `SELECT s.id, s.problem_id, p.title AS problem_title, u.username, s.language, s.status,
            s.runtime_ms, s.memory_kb, s.created_at
     FROM submissions s
     JOIN users u ON u.id = s.user_id
     JOIN problems p ON p.id = s.problem_id
     ${whereSql}
     ORDER BY s.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  ok(res, { items: result.rows, total, page, limit });
}));

router.post('/submissions/:id/rejudge', requireAdmin, asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'submission');

  const result = await dbPool.query(
    'SELECT id, user_id, problem_id, language, source_code, status, ac_counted, created_at FROM submissions WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'submission not found');
  const sub = result.rows[0];

  const mqChannel = getMqChannel();
  if (!mqChannel) throw new HttpError(503, 'judge queue unavailable');

  // S2+ 修复：原子回退 AC 计数，避免并发 rejudge 双重扣减。
  // 仅当本次 rejudge 是「第一个」把 AC+已计数 翻转为 PENDING 的请求时才扣减；
  // 扣减目标为提交原始判定所处周期的 key（created_at 周期），避免跨周/月错扣。
  if (sub.status === 'AC' && sub.ac_counted) {
    const flipped = await dbPool.query(
      `UPDATE submissions SET status = 'PENDING', error_message = NULL, runtime_ms = NULL, memory_kb = NULL,
              failed_case_input = NULL, expected_output = NULL, actual_output = NULL,
              ac_counted = FALSE, updated_at = NOW()
       WHERE id = $1 AND status = 'AC' AND ac_counted = TRUE
       RETURNING user_id`,
      [id]
    );
    if (flipped.rows.length > 0) {
      const keys = [
        'leaderboard:ac',
        `leaderboard:weekly:${getWeekKey(sub.created_at)}`,
        `leaderboard:monthly:${getMonthKey(sub.created_at)}`
      ];
      for (const key of keys) {
        try {
          await redis.zIncrBy(key, -1, String(sub.user_id));
        } catch (err) {
          // Redis 不可用不阻塞 rejudge；重判完成时会按新 verdict 重新计数
          console.error('redis zIncrBy -1 failed during rejudge', err);
        }
      }
    }
  } else {
    await dbPool.query(
      `UPDATE submissions SET status = 'PENDING', error_message = NULL, runtime_ms = NULL, memory_kb = NULL,
              failed_case_input = NULL, expected_output = NULL, actual_output = NULL,
              ac_counted = FALSE, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }
  mqChannel.sendToQueue(
    config.judgeQueue,
    Buffer.from(JSON.stringify({
      submission_id: id,
      user_id: sub.user_id,
      problem_id: sub.problem_id,
      language: sub.language,
      source_code: sub.source_code,
      stdin: ''
    })),
    { persistent: true }
  );
  await writeAudit(AUDIT_ACTIONS.SUBMISSION_REJUDGE, user, 'submission', String(id), {});
  ok(res, { rejudged: true, submission_id: id }, 'rejudge queued');
}));

/** 生成排行榜 weekly/monthly Redis key，与 judge-service redis.period_keys 对齐。
 *  传 date 时按该时间点计算（用于 rejudge 回退原始判定周期的计数），缺省用当前时间。 */
function getWeekKey(date?: string): string {
  const base = date ? new Date(date) : new Date();
  const dayOfWeek = base.getUTCDay(); // 0=Sun
  const mondayMs = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()) - dayOfWeek * 86400000;
  const monday = new Date(mondayMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}
function getMonthKey(date?: string): string {
  const base = date ? new Date(date) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}`;
}

router.get('/announcements', requireAdmin, asyncHandler(async (req, res) => {
  const result = await dbPool.query(
    `SELECT a.id, a.title, a.content, a.is_active, a.pinned, a.category, a.expires_at,
            a.created_by, u.username AS creator_name, a.created_at, a.updated_at
     FROM announcements a
     LEFT JOIN users u ON u.id = a.created_by
     ORDER BY a.pinned DESC, a.updated_at DESC`
  );
  ok(res, { items: result.rows });
}));

router.post('/announcements', requireAdmin, asyncHandler(async (req, res) => {
  const user = req.user!;
  const { title, content, is_active, pinned, category, expires_at } = validateOrFail(CreateAnnouncementSchema, req.body);
  const result = await dbPool.query(
    `INSERT INTO announcements(title, content, is_active, pinned, category, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, title, content, is_active, pinned, category, expires_at, created_by, created_at, updated_at`,
    [
      title,
      content,
      is_active ?? true,
      pinned ?? false,
      category ?? 'general',
      expires_at ?? null,
      user.id
    ]
  );
  await writeAudit(AUDIT_ACTIONS.ANNOUNCEMENT_CREATE, user, 'announcement', String(result.rows[0].id), { title });
  ok(res, result.rows[0], 'announcement created');
}));

router.put('/announcements/:id', requireAdmin, asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'announcement');
  const { title, content, is_active, pinned, category, expires_at } = validateOrFail(UpdateAnnouncementSchema, req.body);
  const sets: string[] = [
    'title = COALESCE($1, title)',
    'content = COALESCE($2, content)',
    'is_active = COALESCE($3, is_active)',
    'pinned = COALESCE($4, pinned)',
    'category = COALESCE($5, category)'
  ];
  const params: unknown[] = [
    title ?? null,
    content ?? null,
    typeof is_active === 'boolean' ? is_active : null,
    typeof pinned === 'boolean' ? pinned : null,
    category ?? null
  ];
  // expires_at: undefined 不更新；null 清空；字符串设置
  if (expires_at !== undefined) {
    params.push(expires_at);
    sets.push(`expires_at = $${params.length}`);
  }
  params.push(id);
  const result = await dbPool.query(
    `UPDATE announcements
     SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING id, title, content, is_active, pinned, category, expires_at, created_by, created_at, updated_at`,
    params
  );
  if (result.rows.length === 0) throw new HttpError(404, 'announcement not found');
  await writeAudit(AUDIT_ACTIONS.ANNOUNCEMENT_UPDATE, user, 'announcement', String(id), { title });
  ok(res, result.rows[0], 'announcement updated');
}));

router.delete('/announcements/:id', requireAdmin, asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'announcement');
  const result = await dbPool.query('DELETE FROM announcements WHERE id = $1 RETURNING id', [id]);
  if (result.rows.length === 0) throw new HttpError(404, 'announcement not found');
  await writeAudit(AUDIT_ACTIONS.ANNOUNCEMENT_DELETE, user, 'announcement', String(id), {});
  ok(res, { deleted: true, id }, 'announcement deleted');
}));

router.get('/daily-problem', asyncHandler(async (req, res) => {
  const { buildTodayResponse } = await import('../services/daily');
  const data = await buildTodayResponse();
  ok(res, data);
}));

router.put('/daily-problem', asyncHandler(async (req, res) => {
  const user = req.user!;
  const { problem_id } = validateOrFail(SetDailyProblemSchema, req.body);
  const problem = await dbPool.query('SELECT id FROM problems WHERE id = $1', [problem_id]);
  if (problem.rows.length === 0) throw new HttpError(404, 'problem not found');
  await dbPool.query(
    `INSERT INTO settings(key, value, updated_at) VALUES ('daily_problem_id', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [String(problem_id)]
  );
  const { bjDateNow } = await import('../services/daily');
  const today = bjDateNow();
  const existing = await dbPool.query(
    'SELECT status FROM daily_problems WHERE date = $1',
    [today]
  );
  if (existing.rows.length > 0 && existing.rows[0].status !== 'pending') {
    throw new HttpError(409, '今日每日一题已结束，不允许重新设置');
  }
  await dbPool.query(
    `INSERT INTO daily_problems(date, problem_id, status) VALUES ($1, $2, 'pending')
     ON CONFLICT (date) DO UPDATE SET problem_id = EXCLUDED.problem_id, status = 'pending', ended_at = NULL`,
    [today, problem_id]
  );
  await writeAudit(AUDIT_ACTIONS.DAILY_PROBLEM_SET, user, 'setting', 'daily_problem_id', { problem_id });
  ok(res, { problem_id }, 'daily problem updated');
}));

router.post('/daily-problem/end', asyncHandler(async (req, res) => {
  const user = req.user!;
  const { endTodayDaily } = await import('../services/daily');
  const settled = await endTodayDaily(user.id);
  if (!settled) throw new HttpError(409, '今日每日一题未开始或已结束');
  await writeAudit(AUDIT_ACTIONS.DAILY_PROBLEM_SET, user, 'daily_problem', 'end', { manual: true });
  ok(res, { ended: true }, 'daily problem ended');
}));

router.get('/audit', requireAdmin, asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const actor = typeof req.query.actor === 'string' && req.query.actor.trim() ? `%${req.query.actor.trim()}%` : null;
  const action = typeof req.query.action === 'string' && req.query.action.trim() ? req.query.action.trim() : null;

  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (actor) {
    values.push(actor);
    clauses.push(`actor_username ILIKE $${values.length}`);
  }
  if (action) {
    values.push(action);
    clauses.push(`action = $${values.length}`);
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await dbPool.query(`SELECT COUNT(*) FROM audit_logs ${whereSql}`, values);
  const total = Number(countResult.rows[0].count);

  values.push(limit, offset);
  const result = await dbPool.query(
    `SELECT id, action, actor_user_id, actor_username, resource_type, resource_id, detail, created_at
     FROM audit_logs ${whereSql}
     ORDER BY id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  ok(res, { items: result.rows, total, page, limit });
}));

router.get('/solutions', asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status : null;
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (status) {
    values.push(status);
    clauses.push(`s.status = $${values.length}`);
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await dbPool.query(
    `SELECT COUNT(*) FROM solutions s ${whereSql}`,
    values
  );
  const total = Number(countResult.rows[0].count);

  values.push(limit, offset);
  const result = await dbPool.query(
    `SELECT s.id, s.user_id, s.problem_id, s.title, s.content, s.status, s.created_at, s.updated_at,
            u.username, p.title AS problem_title
     FROM solutions s
     JOIN users u ON u.id = s.user_id
     JOIN problems p ON p.id = s.problem_id
     ${whereSql}
     ORDER BY s.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  ok(res, { items: result.rows, total, page, limit });
}));

router.put('/solutions/:id', asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'solution');
  const { status } = validateOrFail(ReviewSolutionSchema, req.body);
  const result = await dbPool.query(
    `UPDATE solutions SET status = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, user_id, problem_id, title, status`,
    [status, id]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'solution not found');
  await writeAudit(AUDIT_ACTIONS.SOLUTION_REVIEW, user, 'solution', String(id), { status });
  ok(res, result.rows[0], 'solution reviewed');
}));

router.post('/contests', asyncHandler(async (req, res) => {
  const user = req.user!;
  const { name, description, start_time, end_time, problem_ids } = validateOrFail(CreateContestSchema, req.body);
  const start = new Date(start_time);
  const end = new Date(end_time);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new HttpError(400, 'invalid time format');
  if (end <= start) throw new HttpError(400, 'end time must be after start time');

  const problemCheck = await dbPool.query('SELECT id FROM problems WHERE id = ANY($1::bigint[])', [problem_ids]);
  if (problemCheck.rows.length !== problem_ids.length) throw new HttpError(400, 'some problem ids do not exist');

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const contest = await client.query(
      `INSERT INTO contests(name, description, start_time, end_time, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, start_time, end_time`,
      [name, description, start.toISOString(), end.toISOString(), user.id]
    );
    const contestId = contest.rows[0].id as number;
    for (let i = 0; i < problem_ids.length; i += 1) {
      await client.query(
        `INSERT INTO contest_problems(contest_id, problem_id, sort_order) VALUES ($1, $2, $3)`,
        [contestId, problem_ids[i], i]
      );
    }
    await client.query('COMMIT');
    await writeAudit(AUDIT_ACTIONS.CONTEST_CREATE, user, 'contest', String(contestId), { name, problems: problem_ids.length });
    ok(res, { id: contestId, name, start_time: start.toISOString(), end_time: end.toISOString() }, 'contest created');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.put('/contests/:id', asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'contest');
  await assertCanEditContest(id, user);
  const { name, description, start_time, end_time, problem_ids } = validateOrFail(UpdateContestSchema, req.body);

  let start: Date | null = null;
  let end: Date | null = null;
  if (start_time) {
    start = new Date(start_time);
    if (Number.isNaN(start.getTime())) throw new HttpError(400, 'invalid start time');
  }
  if (end_time) {
    end = new Date(end_time);
    if (Number.isNaN(end.getTime())) throw new HttpError(400, 'invalid end time');
  }
  if (start && end && end <= start) throw new HttpError(400, 'end time must be after start time');

  if (problem_ids) {
    const problemCheck = await dbPool.query('SELECT id FROM problems WHERE id = ANY($1::bigint[])', [problem_ids]);
    if (problemCheck.rows.length !== problem_ids.length) throw new HttpError(400, 'some problem ids do not exist');
  }

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE contests
       SET name = COALESCE($1, name), description = COALESCE($2, description),
           start_time = COALESCE($3, start_time), end_time = COALESCE($4, end_time)
       WHERE id = $5 RETURNING id`,
      [name ?? null, description ?? null, start ? start.toISOString() : null, end ? end.toISOString() : null, id]
    );
    if (result.rows.length === 0) throw new HttpError(404, 'contest not found');
    if (problem_ids) {
      await client.query('DELETE FROM contest_problems WHERE contest_id = $1', [id]);
      for (let i = 0; i < problem_ids.length; i += 1) {
        await client.query(
          `INSERT INTO contest_problems(contest_id, problem_id, sort_order) VALUES ($1, $2, $3)`,
          [id, problem_ids[i], i]
        );
      }
    }
    await client.query('COMMIT');
    await writeAudit(AUDIT_ACTIONS.CONTEST_UPDATE, user, 'contest', String(id), { name, problem_ids });
    ok(res, { id }, 'contest updated');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.delete('/contests/:id', asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = parseId(req.params.id, 'contest');
  await assertCanEditContest(id, user);
  const result = await dbPool.query('DELETE FROM contests WHERE id = $1 RETURNING id', [id]);
  if (result.rows.length === 0) throw new HttpError(404, 'contest not found');
  await writeAudit(AUDIT_ACTIONS.CONTEST_DELETE, user, 'contest', String(id), {});
  ok(res, { deleted: true, id }, 'contest deleted');
}));

// 站内信：管理员发送通知。user_id 指定单用户；broadcast=true 群发所有未封禁用户。
router.post('/notifications', requireAdmin, asyncHandler(async (req, res) => {
  const user = req.user!;
  const { user_id, type, title, content } = validateOrFail(SendNotificationSchema, req.body);

  if (user_id) {
    // 指定用户：校验存在
    const exists = await dbPool.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (exists.rows.length === 0) throw new HttpError(404, 'user not found');
    const result = await dbPool.query(
      `INSERT INTO notifications(user_id, type, title, content, sender_id) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, type, title, content, is_read, sender_id, created_at`,
      [user_id, type, title, content, user.id]
    );
    await writeAudit(AUDIT_ACTIONS.USER_UPDATE, user, 'notification', String(result.rows[0].id), { user_id, type, title });
    ok(res, result.rows[0], 'notification sent');
    return;
  }

  // 群发：插入所有未封禁用户
  // S3 修复：去掉 RETURNING id，避免大用户量下把所有新插入 id 加载到内存导致 OOM。
  // 仅用 rowCount 获取发送数即可。
  const result = await dbPool.query(
    `INSERT INTO notifications(user_id, type, title, content, sender_id)
     SELECT id, $1, $2, $3, $4 FROM users WHERE banned = FALSE`,
    [type, title, content, user.id]
  );
  const sent = result.rowCount ?? 0;
  await writeAudit(AUDIT_ACTIONS.USER_UPDATE, user, 'notification', 'broadcast', { type, title, sent });
  ok(res, { sent, broadcast: true }, 'notification broadcast');
}));

// 首页模块开关（管理员）
router.put('/home-modules', requireAdmin, asyncHandler(async (req, res) => {
  const user = req.user!;
  const body = req.body as { modules?: Record<string, boolean> };
  const saved = await saveHomeModules(body.modules ?? {});
  await writeAudit(AUDIT_ACTIONS.ANNOUNCEMENT_UPDATE, user, 'setting', 'homepage_modules', { modules: saved });
  ok(res, { modules: saved }, 'home modules updated');
}));

export default router;

