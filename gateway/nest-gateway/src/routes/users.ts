import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { dbPool } from '../db';
import { ok, asyncHandler, HttpError, validateOrFail } from '../middleware';
import { requireAuth, getAuthUser, isAdmin } from '../middleware/auth';
import { writeAudit } from '../middleware/audit';
import { AUDIT_ACTIONS } from '../constants';
import { UpdateProfileSchema, ChangePasswordSchema, CreateProfileMessageSchema, UpdateProfileModulesSchema, PROFILE_MODULE_KEYS, PROFILE_VISIBILITIES } from '../schemas';

const router = Router();

/** 读取某用户的公开主页模块可见性配置（未保存的模块默认 public） */
async function loadProfileModules(userId: number): Promise<Record<string, string>> {
  const result = await dbPool.query(
    'SELECT module_key, visibility FROM user_profile_modules WHERE user_id = $1',
    [userId]
  );
  const out: Record<string, string> = {};
  for (const key of PROFILE_MODULE_KEYS) out[key] = 'public';
  for (const row of result.rows) out[row.module_key] = row.visibility;
  return out;
}

/** 判断某访客能否查看目标用户的某主页模块（public 所有人可见；self 仅本人；hidden 所有人不可见） */
async function canViewProfileModule(req: Request, targetUserId: number, moduleKey: string): Promise<boolean> {
  const vis = (await loadProfileModules(targetUserId))[moduleKey] ?? 'public';
  if (vis === 'public') return true;
  if (vis === 'hidden') return false;
  try {
    const viewer = await getAuthUser(req, req.headers.authorization);
    return viewer !== null && viewer.id === targetUserId;
  } catch {
    return false;
  }
}

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const result = await dbPool.query(
    `SELECT id, username, email, role, banned, ban_reason, banned_until, created_at
     FROM users WHERE id = $1`,
    [user.id]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'user not found');
  const row = result.rows[0];
  // 统一 ISO 字符串格式，便于前端解析
  ok(res, {
    ...row,
    banned: Boolean(row.banned),
    banned_until: row.banned_until ? new Date(row.banned_until).toISOString() : null
  });
}));

router.get('/me/stats', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const result = await dbPool.query(
    `SELECT COUNT(*) AS total_submissions,
            COUNT(*) FILTER (WHERE status = 'AC') AS accepted_submissions,
            COUNT(DISTINCT problem_id) FILTER (WHERE status = 'AC') AS solved_problems,
            MAX(created_at) AS last_submitted_at
     FROM submissions WHERE user_id = $1`,
    [user.id]
  );
  ok(res, result.rows[0]);
}));

router.get('/me/favorites', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const result = await dbPool.query(
    `SELECT p.id, p.title, p.difficulty, p.tags
     FROM favorites f
     JOIN problems p ON p.id = f.problem_id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC`,
    [user.id]
  );
  ok(res, { items: result.rows });
}));

router.get('/me/solved', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const result = await dbPool.query(
    `SELECT DISTINCT p.id, p.title, p.difficulty, p.tags
     FROM submissions s
     JOIN problems p ON p.id = s.problem_id
     WHERE s.user_id = $1 AND s.status = 'AC'
     ORDER BY p.id`,
    [user.id]
  );
  ok(res, { items: result.rows });
}));

router.put('/me/favorites/:problemId', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const problemId = Number(req.params.problemId);
  if (!Number.isInteger(problemId) || problemId <= 0) throw new HttpError(400, 'invalid problem id');
  const problem = await dbPool.query('SELECT id FROM problems WHERE id = $1', [problemId]);
  if (problem.rows.length === 0) throw new HttpError(404, 'problem not found');
  await dbPool.query(
    `INSERT INTO favorites (user_id, problem_id) VALUES ($1, $2)
     ON CONFLICT (user_id, problem_id) DO NOTHING`,
    [user.id, problemId]
  );
  ok(res, { favorited: true });
}));

router.delete('/me/favorites/:problemId', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const problemId = Number(req.params.problemId);
  if (!Number.isInteger(problemId) || problemId <= 0) throw new HttpError(400, 'invalid problem id');
  await dbPool.query('DELETE FROM favorites WHERE user_id = $1 AND problem_id = $2', [user.id, problemId]);
  ok(res, { favorited: false });
}));

router.put('/me/profile', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const { username } = validateOrFail(UpdateProfileSchema, req.body);
  if (username === undefined) throw new HttpError(400, 'nothing to update');

  const conflict = await dbPool.query('SELECT id FROM users WHERE username = $1 AND id <> $2', [username, user.id]);
  if (conflict.rows.length > 0) throw new HttpError(409, 'username already taken');

  const result = await dbPool.query(
    'UPDATE users SET username = $1 WHERE id = $2 RETURNING id, username, email, role, created_at',
    [username, user.id]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'user not found');
  await writeAudit(AUDIT_ACTIONS.PROFILE_UPDATE, user, 'user', String(user.id), { username });
  ok(res, result.rows[0], 'profile updated');
}));

router.put('/me/password', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const { old_password, new_password } = validateOrFail(ChangePasswordSchema, req.body);
  const result = await dbPool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  if (result.rows.length === 0) throw new HttpError(404, 'user not found');
  const valid = await bcrypt.compare(old_password, result.rows[0].password_hash);
  if (!valid) throw new HttpError(400, 'old password is incorrect');
  const hashed = await bcrypt.hash(new_password, 10);
  await dbPool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashed, user.id]);
  await writeAudit(AUDIT_ACTIONS.PASSWORD_CHANGE, user, 'user', String(user.id), {});
  ok(res, { updated: true }, 'password changed');
}));

router.get('/me/badges', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const result = await dbPool.query(
    `SELECT status, COUNT(*) AS cnt,
            COUNT(DISTINCT problem_id) FILTER (WHERE status = 'AC') AS solved,
            MIN(created_at) FILTER (WHERE status = 'AC') AS first_ac_at,
            COUNT(*) FILTER (WHERE status = 'AC') AS ac_cnt
     FROM submissions WHERE user_id = $1
     GROUP BY status`,
    [user.id]
  );
  const total = result.rows.reduce((acc, r) => acc + Number(r.cnt), 0);
  const acRows = result.rows.filter((r) => r.status === 'AC');
  const solved = acRows.length > 0 ? Number(acRows[0].solved) : 0;
  const acCount = acRows.length > 0 ? Number(acRows[0].ac_cnt) : 0;
  const firstAcAt = acRows.length > 0 ? acRows[0].first_ac_at : null;

  const difficulties = await dbPool.query(
    `SELECT COUNT(DISTINCT p.difficulty) AS diff_cnt
     FROM submissions s JOIN problems p ON p.id = s.problem_id
     WHERE s.user_id = $1 AND s.status = 'AC'`,
    [user.id]
  );
  const diffCount = Number(difficulties.rows[0].diff_cnt);

  const days = await dbPool.query(
    `SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date AS d
     FROM submissions WHERE user_id = $1 AND status = 'AC'`,
    [user.id]
  );
  const daySet = new Set(days.rows.map((r) => String(r.d)));
  let streak = 0;
  const today = new Date().toISOString().slice(0, 10);
  const cursor = new Date(today);
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const badges = [
    { code: 'first_blood', name: '首杀', desc: '完成第一道 AC', earned: acCount >= 1, earned_at: firstAcAt },
    { code: 'solved_5', name: '青铜选手', desc: 'AC 5 题', earned: solved >= 5 },
    { code: 'solved_10', name: '白银选手', desc: 'AC 10 题', earned: solved >= 10 },
    { code: 'solved_20', name: '黄金选手', desc: 'AC 20 题', earned: solved >= 20 },
    { code: 'sub_50', name: '勤学不辍', desc: '提交 50 次', earned: total >= 50 },
    { code: 'sub_100', name: '百炼成钢', desc: '提交 100 次', earned: total >= 100 },
    { code: 'streak_3', name: '三日之约', desc: '连续 3 天打卡 AC', earned: streak >= 3 },
    { code: 'streak_7', name: '持之以恒', desc: '连续 7 天打卡 AC', earned: streak >= 7 },
    { code: 'all_rounder', name: '全能选手', desc: '三种难度均有 AC', earned: diffCount >= 3 }
  ];
  ok(res, { items: badges, solved, submissions: total, streak });
}));

router.get('/me/home-modules', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const modules = await loadProfileModules(user.id);
  ok(res, { modules });
}));

router.put('/me/home-modules', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const { modules } = validateOrFail(UpdateProfileModulesSchema, req.body);
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, visibility] of Object.entries(modules)) {
      if (!PROFILE_MODULE_KEYS.includes(key as (typeof PROFILE_MODULE_KEYS)[number])) continue;
      if (!PROFILE_VISIBILITIES.includes(visibility as (typeof PROFILE_VISIBILITIES)[number])) continue;
      await client.query(
        `INSERT INTO user_profile_modules (user_id, module_key, visibility, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, module_key) DO UPDATE SET visibility = EXCLUDED.visibility, updated_at = NOW()`,
        [user.id, key, visibility]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  ok(res, { modules: await loadProfileModules(user.id) }, 'profile modules updated');
}));

router.get('/:username', asyncHandler(async (req, res) => {
  const username = req.params.username;
  const result = await dbPool.query(
    `SELECT id, username, role, banned, ban_reason, banned_until, created_at FROM users WHERE username = $1`,
    [username]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'user not found');
  const u = result.rows[0];

  const stats = await dbPool.query(
    `SELECT COUNT(*) AS submissions,
            COUNT(DISTINCT problem_id) FILTER (WHERE status = 'AC') AS solved,
            COUNT(*) FILTER (WHERE status = 'AC') AS ac_count
     FROM submissions WHERE user_id = $1`,
    [u.id]
  );

  const solved = await dbPool.query(
    `SELECT DISTINCT p.id, p.title, p.difficulty
     FROM submissions s JOIN problems p ON p.id = s.problem_id
     WHERE s.user_id = $1 AND s.status = 'AC' ORDER BY p.id`,
    [u.id]
  );

  const activity = await dbPool.query(
    `SELECT (created_at AT TIME ZONE 'UTC')::date AS d, COUNT(*) AS cnt
     FROM submissions WHERE user_id = $1 AND status = 'AC'
     GROUP BY d ORDER BY d`,
    [u.id]
  );

  const social = await dbPool.query(
    `SELECT
       (SELECT COUNT(*) FROM follows WHERE follow_user_id = $1) AS followers,
       (SELECT COUNT(*) FROM follows WHERE user_id = $1) AS following`,
    [u.id]
  );

  // S5 修复：封禁原因属于隐私信息，仅本人或管理员可见；其他访客只看到 banned: boolean
  let banReason: string | null = null;
  let bannedUntil: string | null = null;
  let followedByMe = false;
  let isOwner = false;
  const rawModules = await loadProfileModules(Number(u.id));
  // 模块可见性按访客过滤：hidden 所有人不可见；self 仅本人可见
  const viewerModules: Record<string, string> = {};
  try {
    const viewer = await getAuthUser(req, req.headers.authorization);
    if (viewer && (isAdmin(viewer) || viewer.id === Number(u.id))) {
      banReason = u.ban_reason ?? null;
      bannedUntil = u.banned_until ? new Date(u.banned_until).toISOString() : null;
    }
    if (viewer && viewer.id === Number(u.id)) {
      isOwner = true;
      for (const [key, vis] of Object.entries(rawModules)) viewerModules[key] = vis;
    } else {
      for (const [key, vis] of Object.entries(rawModules)) {
        viewerModules[key] = vis === 'public' ? 'public' : 'hidden';
      }
    }
    if (viewer && viewer.id !== Number(u.id)) {
      const f = await dbPool.query('SELECT 1 FROM follows WHERE user_id = $1 AND follow_user_id = $2', [viewer.id, u.id]);
      followedByMe = f.rows.length > 0;
    }
  } catch {
    // 未登录或 token 无效：保持只返 banned: boolean
    for (const [key, vis] of Object.entries(rawModules)) {
      viewerModules[key] = vis === 'public' ? 'public' : 'hidden';
    }
  }

  // 数据按模块可见性过滤：仅隐藏 modules 键不够，隐藏的模块不下发对应数据（防直接调 API 绕过）
  const canSee = (key: string) => viewerModules[key] !== 'hidden';
  ok(res, {
    id: u.id,
    username: u.username,
    role: u.role,
    // 公开主页仅展示是否被封禁；具体原因/解封时间仅本人或管理员可见
    banned: Boolean(u.banned),
    ban_reason: banReason,
    banned_until: bannedUntil,
    created_at: u.created_at,
    submissions: canSee('solved') ? Number(stats.rows[0].submissions) : 0,
    solved_count: canSee('solved') ? Number(stats.rows[0].solved) : 0,
    ac_count: canSee('solved') ? Number(stats.rows[0].ac_count) : 0,
    solved: canSee('solved') ? solved.rows : [],
    activity: canSee('heatmap') ? activity.rows.map((r) => ({ date: String(r.d), count: Number(r.cnt) })) : [],
    follower_count: canSee('social') ? Number(social.rows[0].followers) : 0,
    following_count: canSee('social') ? Number(social.rows[0].following) : 0,
    followed_by_me: canSee('social') ? followedByMe : false,
    is_owner: isOwner,
    modules: viewerModules
  });
}));

router.put('/:id/follow', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) throw new HttpError(400, 'invalid user id');
  if (targetId === user.id) throw new HttpError(400, '不能关注自己');
  const target = await dbPool.query('SELECT id FROM users WHERE id = $1', [targetId]);
  if (target.rows.length === 0) throw new HttpError(404, 'user not found');
  await dbPool.query(
    `INSERT INTO follows(user_id, follow_user_id) VALUES ($1, $2)
     ON CONFLICT (user_id, follow_user_id) DO NOTHING`,
    [user.id, targetId]
  );
  const cnt = await dbPool.query('SELECT COUNT(*) AS cnt FROM follows WHERE follow_user_id = $1', [targetId]);
  ok(res, { following: true, follower_count: Number(cnt.rows[0].cnt) });
}));

router.delete('/:id/follow', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) throw new HttpError(400, 'invalid user id');
  await dbPool.query('DELETE FROM follows WHERE user_id = $1 AND follow_user_id = $2', [user.id, targetId]);
  const cnt = await dbPool.query('SELECT COUNT(*) AS cnt FROM follows WHERE follow_user_id = $1', [targetId]);
  ok(res, { following: false, follower_count: Number(cnt.rows[0].cnt) });
}));

router.get('/:username/followers', asyncHandler(async (req, res) => {
  const username = req.params.username;
  const target = await dbPool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (target.rows.length === 0) throw new HttpError(404, 'user not found');
  if (!(await canViewProfileModule(req, Number(target.rows[0].id), 'social'))) {
    ok(res, { items: [] });
    return;
  }
  const result = await dbPool.query(
    `SELECT u.id, u.username, u.role, f.created_at AS followed_at
     FROM follows f JOIN users u ON u.id = f.user_id
     WHERE f.follow_user_id = $1 ORDER BY f.created_at DESC LIMIT 100`,
    [target.rows[0].id]
  );
  ok(res, { items: result.rows.map((r) => ({ ...r, followed_at: r.followed_at ? new Date(r.followed_at).toISOString() : null })) });
}));

router.get('/:username/following', asyncHandler(async (req, res) => {
  const username = req.params.username;
  const target = await dbPool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (target.rows.length === 0) throw new HttpError(404, 'user not found');
  if (!(await canViewProfileModule(req, Number(target.rows[0].id), 'social'))) {
    ok(res, { items: [] });
    return;
  }
  const result = await dbPool.query(
    `SELECT u.id, u.username, u.role, f.created_at AS followed_at
     FROM follows f JOIN users u ON u.id = f.follow_user_id
     WHERE f.user_id = $1 ORDER BY f.created_at DESC LIMIT 100`,
    [target.rows[0].id]
  );
  ok(res, { items: result.rows.map((r) => ({ ...r, followed_at: r.followed_at ? new Date(r.followed_at).toISOString() : null })) });
}));

router.get('/:username/badges', asyncHandler(async (req, res) => {
  const target = await dbPool.query('SELECT id FROM users WHERE username = $1', [req.params.username]);
  if (target.rows.length === 0) throw new HttpError(404, 'user not found');
  const uid = Number(target.rows[0].id);
  if (!(await canViewProfileModule(req, uid, 'badges'))) {
    ok(res, { items: [], solved: 0, submissions: 0, streak: 0 });
    return;
  }

  const result = await dbPool.query(
    `SELECT status, COUNT(*) AS cnt,
            COUNT(DISTINCT problem_id) FILTER (WHERE status = 'AC') AS solved,
            COUNT(*) FILTER (WHERE status = 'AC') AS ac_cnt
     FROM submissions WHERE user_id = $1
     GROUP BY status`,
    [uid]
  );
  const total = result.rows.reduce((acc, r) => acc + Number(r.cnt), 0);
  const acRows = result.rows.filter((r) => r.status === 'AC');
  const solved = acRows.length > 0 ? Number(acRows[0].solved) : 0;
  const acCount = acRows.length > 0 ? Number(acRows[0].ac_cnt) : 0;

  const difficulties = await dbPool.query(
    `SELECT COUNT(DISTINCT p.difficulty) AS diff_cnt
     FROM submissions s JOIN problems p ON p.id = s.problem_id
     WHERE s.user_id = $1 AND s.status = 'AC'`,
    [uid]
  );
  const diffCount = Number(difficulties.rows[0].diff_cnt);

  const days = await dbPool.query(
    `SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date AS d
     FROM submissions WHERE user_id = $1 AND status = 'AC'`,
    [uid]
  );
  const daySet = new Set(days.rows.map((r) => String(r.d)));
  let streak = 0;
  const today = new Date().toISOString().slice(0, 10);
  const cursor = new Date(today);
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const badges = [
    { code: 'first_blood', name: '首杀', desc: '完成第一道 AC', earned: acCount >= 1 },
    { code: 'solved_5', name: '青铜选手', desc: 'AC 5 题', earned: solved >= 5 },
    { code: 'solved_10', name: '白银选手', desc: 'AC 10 题', earned: solved >= 10 },
    { code: 'solved_20', name: '黄金选手', desc: 'AC 20 题', earned: solved >= 20 },
    { code: 'sub_50', name: '勤学不辍', desc: '提交 50 次', earned: total >= 50 },
    { code: 'sub_100', name: '百炼成钢', desc: '提交 100 次', earned: total >= 100 },
    { code: 'streak_3', name: '三日之约', desc: '连续 3 天打卡 AC', earned: streak >= 3 },
    { code: 'streak_7', name: '持之以恒', desc: '连续 7 天打卡 AC', earned: streak >= 7 },
    { code: 'all_rounder', name: '全能选手', desc: '三种难度均有 AC', earned: diffCount >= 3 }
  ];
  ok(res, { items: badges, solved, submissions: total, streak });
}));

router.get('/:username/messages', asyncHandler(async (req, res) => {
  const username = req.params.username;
  const target = await dbPool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (target.rows.length === 0) throw new HttpError(404, 'user not found');
  if (!(await canViewProfileModule(req, Number(target.rows[0].id), 'messages'))) {
    ok(res, { items: [] });
    return;
  }
  const result = await dbPool.query(
    `SELECT m.id, m.content, m.created_at, u.id AS author_id, u.username AS author_name
     FROM profile_messages m JOIN users u ON u.id = m.author_user_id
     WHERE m.target_user_id = $1
     ORDER BY m.id DESC LIMIT 100`,
    [target.rows[0].id]
  );
  ok(res, {
    items: result.rows.map((r) => ({
      id: r.id,
      content: r.content,
      author_id: r.author_id,
      author_name: r.author_name,
      created_at: new Date(r.created_at).toISOString()
    }))
  });
}));

router.post('/:username/messages', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user!;
  const { content } = validateOrFail(CreateProfileMessageSchema, req.body);
  const target = await dbPool.query('SELECT id FROM users WHERE username = $1', [req.params.username]);
  if (target.rows.length === 0) throw new HttpError(404, 'user not found');
  // 留言板按可见性开放：hidden 一律禁止；self 仅本人可留言；public 所有人可留言（允许给自己留言）
  const vis = (await loadProfileModules(Number(target.rows[0].id)))['messages'] ?? 'public';
  if (vis === 'hidden') throw new HttpError(403, '留言板未开放');
  if (vis === 'self' && user.id !== Number(target.rows[0].id)) throw new HttpError(403, '留言板未开放');
  const result = await dbPool.query(
    `INSERT INTO profile_messages(target_user_id, author_user_id, content)
     VALUES ($1, $2, $3) RETURNING id, content, created_at`,
    [target.rows[0].id, user.id, content]
  );
  ok(res, {
    id: result.rows[0].id,
    content: result.rows[0].content,
    created_at: new Date(result.rows[0].created_at).toISOString(),
    author_id: user.id,
    author_name: user.username
  }, 'message posted');
}));

export default router;
