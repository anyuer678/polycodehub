export const LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'c', 'go', 'rust'] as const;
export const STATUSES = ['PENDING', 'AC', 'WA', 'CE', 'RE', 'TLE', 'MLE'] as const;
export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export const PERIODS = ['all', 'weekly', 'monthly'] as const;

export const ROLE_ADMIN = 'admin';
export const ROLE_TEACHER = 'teacher';
export const ROLE_USER = 'user';

export const STAFF_ROLES = [ROLE_ADMIN, ROLE_TEACHER] as const;

// Cookie 配置：JWT 改为 httpOnly Cookie 存储，避免 XSS 窃取。
// SameSite=Lax 兼容导航跳转；生产环境务必配合 HTTPS 设置 Secure=true。
export const AUTH_COOKIE = 'token';
export const AUTH_COOKIE_MAX_AGE_S = 86400; // 1 天，与 JWT 默认过期对齐

// 登录失败计数：5 次失败后锁定 15 分钟
export const LOGIN_FAIL_MAX = 5;
export const LOGIN_FAIL_LOCK_S = 900;

export const AUDIT_ACTIONS = {
  PROBLEM_CREATE: 'problem.create',
  PROBLEM_UPDATE: 'problem.update',
  PROBLEM_DELETE: 'problem.delete',
  TESTCASE_CREATE: 'testcase.create',
  TESTCASE_BULK_CREATE: 'testcase.bulk_create',
  TESTCASE_UPDATE: 'testcase.update',
  TESTCASE_DELETE: 'testcase.delete',
  SUBMISSION_ENQUEUE: 'submission.enqueue',
  SUBMISSION_REJUDGE: 'submission.rejudge',
  USER_UPDATE: 'user.update',
  ANNOUNCEMENT_CREATE: 'announcement.create',
  ANNOUNCEMENT_UPDATE: 'announcement.update',
  ANNOUNCEMENT_DELETE: 'announcement.delete',
  DAILY_PROBLEM_SET: 'daily_problem.set',
  PROBLEM_BULK_CREATE: 'problem.bulk_create',
  PROFILE_UPDATE: 'profile.update',
  PASSWORD_CHANGE: 'password.change',
  SUBMISSION_SHARE: 'submission.share',
  RUN_SUBMIT: 'run.submit',
  SOLUTION_CREATE: 'solution.create',
  SOLUTION_REVIEW: 'solution.review',
  CONTEST_CREATE: 'contest.create',
  CONTEST_UPDATE: 'contest.update',
  CONTEST_DELETE: 'contest.delete'
} as const;

export const REDIS_KEYS = {
  authUser: (token: string) => `auth:user:${sha256(token)}`,
  // 用户 auth 缓存版本号：admin 更新用户时 INCR，缓存命中时比对，避免 role/banned 变更后 5 分钟窗口期
  authUserVersion: (userId: number) => `auth:user:ver:${userId}`,
  // 登录失败计数：用于账户锁定
  loginFail: (email: string) => `auth:login:fail:${email}`,
  rate: (ip: string) => `rate:${ip}`,
  authRate: (ip: string) => `auth-rate:${ip}`,
  leaderboardAll: 'leaderboard:ac',
  leaderboardWeekly: () => weeklyKey(),
  leaderboardMonthly: () => monthlyKey()
};

function sha256(input: string): string {
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function weeklyKey(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  now.setUTCDate(now.getUTCDate() - diff);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `leaderboard:weekly:${y}-${m}-${d}`;
}

export function monthlyKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `leaderboard:monthly:${y}-${m}`;
}
