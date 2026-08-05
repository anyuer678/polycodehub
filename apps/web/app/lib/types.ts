export interface UserInfo {
  id: number;
  email: string;
  username: string;
  role: string;
  // 封号透明化：登录后 /me 返回的封禁状态字段（旧 token 可能不含，需兼容 undefined）
  banned?: boolean;
  ban_reason?: string | null;
  banned_until?: string | null;
}

export interface Problem {
  id: number;
  title: string;
  difficulty: string;
  description: string;
  tags: string[];
  ac_count: number;
  submission_count: number;
  ac_rate: number;
}

export interface FavoriteItem {
  id: number;
  title: string;
  difficulty: string;
  tags: string[];
}

export interface SolvedItem {
  id: number;
  title: string;
  difficulty: string;
  tags: string[];
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  is_active: boolean;
  pinned?: boolean;
  category?: string;
  expires_at?: string | null;
  created_by?: number | null;
  creator_name?: string | null;
  created_at: string;
  updated_at: string;
}

// 站内信：管理员推送的通知
export interface Notification {
  id: number;
  type: string;
  title: string;
  content: string;
  is_read: boolean;
  sender_id?: number | null;
  sender_name?: string | null;
  created_at: string;
}

// 站内信列表响应：附带未读数
export interface NotificationListResponse {
  items: Notification[];
  total: number;
  unread: number;
  page: number;
  limit: number;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  role: string;
  banned: boolean;
  ban_reason: string | null;
  banned_until: string | null;
  created_at: string;
  submission_count: number;
  ac_count: number;
}

export interface AdminSubmission {
  id: number;
  problem_id: number;
  problem_title: string;
  username: string;
  language: string;
  status: string;
  runtime_ms: number | null;
  memory_kb: number | null;
  created_at: string;
}

export interface Submission {
  id: number;
  user_id: number;
  problem_id: number;
  problem_title: string;
  language: string;
  status: string;
  runtime_ms: number | null;
  memory_kb: number | null;
  error_message?: string | null;
  created_at: string;
}

export interface SubmissionDetail {
  id: number;
  user_id: number;
  problem_id: number;
  problem_title?: string;
  language: string;
  status: string;
  runtime_ms: number | null;
  memory_kb: number | null;
  error_message: string | null;
  failed_case_input: string | null;
  expected_output: string | null;
  actual_output: string | null;
  share_token?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestCase {
  id: number;
  problem_id: number;
  input_data: string;
  expected_output: string;
  is_sample: boolean;
}

export interface LeaderboardRow {
  rank: number;
  user_id: number;
  username: string;
  ac_count: number;
  submission_count: number;
  pass_rate: number;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditLog {
  id: number;
  action: string;
  actor_user_id: number | null;
  actor_username: string | null;
  resource_type: string;
  resource_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface Solution {
  id: number;
  user_id: number;
  problem_id: number;
  problem_title?: string;
  username?: string;
  title: string;
  content: string;
  status: string;
  created_at: string;
  updated_at?: string;
}

export interface Contest {
  id: number;
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  status: 'upcoming' | 'ongoing' | 'finished';
  problem_count?: number;
  created_by?: number | null;
  creator_name?: string | null;
  created_at?: string;
  problems?: Array<{ sort_order: number; id: number; title: string; difficulty: string; tags: string[] }>;
}

export interface ContestRow {
  rank: number;
  user_id: number;
  username: string;
  ac_count: number;
  penalty_sec: number;
  penalty_min: number;
}

export interface RunResult {
  id: number;
  user_id: number;
  language: string;
  source_code: string;
  stdin: string;
  status: string;
  stdout: string | null;
  stderr: string | null;
  runtime_ms: number | null;
  created_at: string;
}

export interface SharedSubmission {
  id: number;
  user_id: number;
  username: string;
  problem_id: number;
  problem_title: string;
  language: string;
  status: string;
  runtime_ms: number | null;
  memory_kb: number | null;
  error_message: string | null;
  failed_case_input: string | null;
  expected_output: string | null;
  actual_output: string | null;
  source_code: string;
  created_at: string;
}

export interface Badge {
  code: string;
  name: string;
  desc: string;
  earned: boolean;
  earned_at?: string | null;
}

export interface BadgeSet {
  items: Badge[];
  solved: number;
  submissions: number;
  streak: number;
}

export interface PublicUser {
  id: number;
  username: string;
  role: string;
  // 封号透明化：公开主页展示的封禁状态
  banned: boolean;
  ban_reason: string | null;
  banned_until: string | null;
  created_at: string;
  submissions: number;
  solved_count: number;
  ac_count: number;
  solved: Array<{ id: number; title: string; difficulty: string }>;
  activity: Array<{ date: string; count: number }>;
  follower_count: number;
  following_count: number;
  followed_by_me: boolean;
  // 公开主页模块可见性（已按访客过滤）：public 可见 / hidden 不可见（self 对本人显示为 self）
  is_owner: boolean;
  modules: Record<string, 'public' | 'hidden' | 'self'>;
}

export interface FollowUser {
  id: number;
  username: string;
  role: string;
  followed_at: string | null;
}

export interface ProfileMessage {
  id: number;
  content: string;
  author_id: number;
  author_name: string;
  created_at: string;
}

export interface SolutionComment {
  id: number;
  content: string;
  user_id: number;
  username: string;
  created_at: string;
}
