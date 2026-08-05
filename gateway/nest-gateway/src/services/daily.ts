import { dbPool } from '../db';

/** 以北京时间（UTC+8）为业务时区：每日一题以北京自然日截止（当日 24:00 = 次日 00:00） */
const BJ_OFFSET_MS = 8 * 3600 * 1000;

export function bjDateNow(): string {
  return new Date(Date.now() + BJ_OFFSET_MS).toISOString().slice(0, 10);
}

/** 北京某日 00:00 对应的 UTC 时间 */
function bjDayStartUtc(date: string): string {
  return new Date(`${date}T00:00:00+08:00`).toISOString();
}

/** 北京某日 24:00（次日 00:00）对应的 UTC 时间 = 截止时间 */
export function bjDayEndUtc(date: string): string {
  const start = new Date(`${date}T00:00:00+08:00`);
  return new Date(start.getTime() + 86400000).toISOString();
}

/** 结算所有已过截止但仍 pending 的每日一题（幂等：只更新 status=pending 的记录）。返回本次结算条数 */
export async function settleOverdueDailyProblems(): Promise<number> {
  const result = await dbPool.query(`SELECT id, date FROM daily_problems WHERE status = 'pending'`);
  const overdueIds: number[] = [];
  for (const row of result.rows) {
    if (Date.now() >= new Date(bjDayEndUtc(String(row.date))).getTime()) {
      overdueIds.push(Number(row.id));
    }
  }
  if (overdueIds.length === 0) return 0;
  const updated = await dbPool.query(
    `UPDATE daily_problems
     SET status = 'finished', end_type = 'auto', ended_at = NOW()
     WHERE id = ANY($1::bigint[]) AND status = 'pending'`,
    [overdueIds]
  );
  return Number(updated.rowCount ?? 0);
}

/** 确保今天的记录存在（取 settings.daily_problem_id），并发起惰性结算。返回今天记录 */
export async function getOrCreateTodayDaily(): Promise<{ date: string; problemId: number | null; status?: string }> {
  const date = bjDateNow();
  await settleOverdueDailyProblems();

  const setting = await dbPool.query(`SELECT value FROM settings WHERE key = 'daily_problem_id'`);
  const problemId = setting.rows.length > 0 ? Number(setting.rows[0].value) : null;
  if (problemId) {
    await dbPool.query(
      `INSERT INTO daily_problems(date, problem_id, status) VALUES ($1, $2, 'pending')
       ON CONFLICT (date) DO NOTHING`,
      [date, problemId]
    );
  }
  return { date, problemId };
}

export interface DailyResult {
  submissions: number;
  ac_submissions: number;
  ac_users: number;
  pass_rate: number;
  fastest: { username: string; runtime_ms: number } | null;
  leaderboard: Array<{ rank: number; username: string; first_ac_at: string }>;
}

/** 计算某日每日一题的当日情况（该日北京时间窗口内的提交） */
export async function computeDailyResult(date: string, problemId: number): Promise<DailyResult> {
  const startUtc = bjDayStartUtc(date);
  const endUtc = bjDayEndUtc(date);

  const windowClause = `created_at >= $1 AND created_at < $2 AND problem_id = $3`;
  const windowClauseS = `s.created_at >= $1 AND s.created_at < $2 AND s.problem_id = $3`;

  const totals = await dbPool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'AC')::int AS ac
     FROM submissions WHERE ${windowClause}`,
    [startUtc, endUtc, problemId]
  );
  const submissions = totals.rows[0].total as number;
  const acSubmissions = totals.rows[0].ac as number;

  const acUsers = await dbPool.query(
    `SELECT COUNT(DISTINCT user_id)::int AS cnt FROM submissions WHERE ${windowClause} AND status = 'AC'`,
    [startUtc, endUtc, problemId]
  );

  const fastest = await dbPool.query(
    `SELECT u.username, s.runtime_ms
     FROM submissions s JOIN users u ON u.id = s.user_id
     WHERE ${windowClauseS} AND status = 'AC' AND s.runtime_ms IS NOT NULL
     ORDER BY s.runtime_ms ASC, s.created_at ASC LIMIT 1`,
    [startUtc, endUtc, problemId]
  );

  const leaderboard = await dbPool.query(
    `WITH ac_first AS (
       SELECT user_id, MIN(created_at) AS first_ac
       FROM submissions WHERE ${windowClause} AND status = 'AC'
       GROUP BY user_id
     )
     SELECT u.username, af.first_ac
     FROM ac_first af JOIN users u ON u.id = af.user_id
     ORDER BY af.first_ac ASC LIMIT 10`,
    [startUtc, endUtc, problemId]
  );

  return {
    submissions,
    ac_submissions: acSubmissions,
    ac_users: acUsers.rows[0].cnt as number,
    pass_rate: submissions > 0 ? Math.round((acSubmissions / submissions) * 100) : 0,
    fastest: fastest.rows.length > 0 && fastest.rows[0].runtime_ms != null
      ? { username: String(fastest.rows[0].username), runtime_ms: Number(fastest.rows[0].runtime_ms) }
      : null,
    leaderboard: leaderboard.rows.map((r, i) => ({
      rank: i + 1,
      username: String(r.username),
      first_ac_at: r.first_ac ? new Date(r.first_ac).toISOString() : ''
    }))
  };
}

/** 组装公开响应：今日记录 + 题目 + 状态 + 结果 */
export async function buildTodayResponse() {
  const daily = await getOrCreateTodayDaily();
  const { date, problemId } = daily;
  if (!problemId) return { date, problem: null, status: null };

  try {
    await settleOverdueDailyProblems();
  } catch {
    // 结算失败不影响主流程
  }
  const record = await dbPool.query(`SELECT status, end_type, ended_at FROM daily_problems WHERE date = $1`, [date]);
  const status = record.rows.length > 0 ? record.rows[0].status : 'pending';
  const endedAt = record.rows.length > 0 ? record.rows[0].ended_at : null;

  const problem = await dbPool.query(
    `SELECT p.id, p.title, p.difficulty, p.description, p.tags
     FROM problems p WHERE p.id = $1`,
    [problemId]
  );
  if (problem.rows.length === 0) return { date, problem: null, status };

  const row = problem.rows[0];
  const result = status === 'finished'
    ? await computeDailyResult(date, problemId)
    : null;

  return {
    date,
    problem: {
      id: row.id,
      title: row.title,
      difficulty: row.difficulty,
      description: row.description,
      tags: row.tags || []
    },
    status,
    end_type: record.rows.length > 0 ? record.rows[0].end_type : null,
    ended_at: endedAt ? new Date(endedAt).toISOString() : null,
    result
  };
}

/** 批处理计算多日历史摘要（取代逐日 N+1）：返回 key 为日期字符串的摘要 map（含 fastest） */
async function computeHistorySummaries(
  dates: Array<{ date: string; problemId: number }>
): Promise<Map<string, { submissions: number; ac_submissions: number; ac_users: number; fastest: { username: string; runtime_ms: number } | null }>> {
  const map = new Map<string, { submissions: number; ac_submissions: number; ac_users: number; fastest: { username: string; runtime_ms: number } | null }>();
  if (dates.length === 0) return map;

  const dateArr = dates.map((d) => d.date + 'T00:00:00+08:00');
  const problemArr = dates.map((d) => d.problemId);
  const startArr = dates.map((d) => bjDayStartUtc(d.date));
  const endArr = dates.map((d) => bjDayEndUtc(d.date));

  const totals = await dbPool.query(
    `WITH d AS (
       SELECT unnest($1::timestamptz[]) AS date, unnest($2::bigint[]) AS problem_id,
              unnest($3::timestamptz[]) AS start_utc, unnest($4::timestamptz[]) AS end_utc
     )
     SELECT d.date,
            COUNT(s.id)::int AS total,
            COUNT(s.id) FILTER (WHERE s.status = 'AC')::int AS ac,
            COUNT(DISTINCT s.user_id) FILTER (WHERE s.status = 'AC')::int AS ac_users
     FROM d
     LEFT JOIN submissions s ON s.problem_id = d.problem_id
        AND s.created_at >= d.start_utc AND s.created_at < d.end_utc
     GROUP BY d.date`,
    [dateArr, problemArr, startArr, endArr]
  );

  const fastest = await dbPool.query(
    `WITH d AS (
       SELECT unnest($1::timestamptz[]) AS date, unnest($2::bigint[]) AS problem_id,
              unnest($3::timestamptz[]) AS start_utc, unnest($4::timestamptz[]) AS end_utc
     )
     SELECT DISTINCT ON (x.date) x.date, u.username, x.runtime_ms
     FROM (
       SELECT d.date, s.user_id, s.runtime_ms
       FROM d
       JOIN submissions s ON s.problem_id = d.problem_id
          AND s.created_at >= d.start_utc AND s.created_at < d.end_utc
          AND s.status = 'AC' AND s.runtime_ms IS NOT NULL
     ) x
     JOIN users u ON u.id = x.user_id
     ORDER BY x.date, x.runtime_ms ASC`,
    [dateArr, problemArr, startArr, endArr]
  );

  for (const t of totals.rows) {
    const key = new Date(t.date).toISOString();
    const fastestRow = fastest.rows.find((f) => new Date(f.date).toISOString() === key);
    map.set(key, {
      submissions: Number(t.total),
      ac_submissions: Number(t.ac),
      ac_users: Number(t.ac_users),
      fastest: fastestRow && fastestRow.runtime_ms != null
        ? { username: String(fastestRow.username), runtime_ms: Number(fastestRow.runtime_ms) }
        : null
    });
  }
  return map;
}

/** 最近历史记录（带结果摘要） */
export async function buildHistory(limit: number) {
  const records = await dbPool.query(
    `SELECT d.date, d.problem_id, d.status, d.end_type, d.ended_at, p.title, p.difficulty
     FROM daily_problems d JOIN problems p ON p.id = d.problem_id
     ORDER BY d.date DESC LIMIT $1`,
    [Math.min(30, Math.max(1, limit))]
  );
  const finished = records.rows.filter((r) => r.status === 'finished');
  const summaries = await computeHistorySummaries(
    finished.map((r) => ({ date: String(r.date), problemId: Number(r.problem_id) }))
  );
  const items = records.rows.map((r) => {
    const key = new Date(`${String(r.date)}T00:00:00+08:00`).toISOString();
    const summary = r.status === 'finished' ? summaries.get(key) : null;
    return {
      date: r.date,
      problem_id: r.problem_id,
      title: r.title,
      difficulty: r.difficulty,
      status: r.status,
      end_type: r.end_type,
      ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      result: summary ? {
        submissions: summary.submissions,
        ac_users: summary.ac_users,
        pass_rate: summary.submissions > 0 ? Math.round((summary.ac_submissions / summary.submissions) * 100) : 0,
        fastest: summary.fastest
      } : null
    };
  });
  return { items };
}

/** 提前结束今天的每日一题（教师/管理员）。返回是否发生结算 */
export async function endTodayDaily(actorId: number): Promise<boolean> {
  const date = bjDateNow();
  const result = await dbPool.query(
    `UPDATE daily_problems
     SET status = 'finished', end_type = 'manual', ended_at = NOW(), ended_by = $1
     WHERE date = $2 AND status = 'pending'
     RETURNING id`,
    [actorId, date]
  );
  return result.rows.length > 0;
}