"use client";

import type { UserInfo } from './types';

export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080';

export const LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'c', 'go', 'rust'] as const;

export const STATUSES = ['PENDING', 'AC', 'WA', 'CE', 'RE', 'TLE', 'MLE'] as const;

export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  requestId?: string;
  data: T;
  detail?: unknown;
}

// Token 不再存储在 localStorage/sessionStorage：改由网关设置 httpOnly Cookie，
// 前端无法通过 JS 读取，防御 XSS 窃取。所有请求通过 credentials: 'include' 自动携带 Cookie。
// 用户信息（非敏感：id/email/username/role）仍存本地用于 UI 展示与刷新恢复。
const USER_KEY = 'user';

export function getStoredUser(): UserInfo | null {
  try {
    const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserInfo;
  } catch {
    return null;
  }
}

let snapshotKey = '';
let snapshotUser: UserInfo | null | undefined;
export function getStoredUserSnapshot(): UserInfo | null {
  const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
  if (raw !== snapshotKey || snapshotUser === undefined) {
    snapshotKey = raw || '';
    try {
      snapshotUser = raw ? (JSON.parse(raw) as UserInfo) : null;
    } catch {
      snapshotUser = null;
    }
  }
  return snapshotUser;
}

export function writeStoredUser(user: UserInfo): void {
  // 没有 remember 参数后，统一存 sessionStorage（关闭浏览器即清，更安全）；
  // 用户主动勾选"记住我"可改写为 localStorage，但当前简化为统一 sessionStorage。
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.removeItem(USER_KEY);
}

export function clearStoredUser(): void {
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(USER_KEY);
}

/** 通知服务端清除 httpOnly Cookie（即使 token 已过期，/logout 仍会清 Cookie） */
async function clearAuthCookie(): Promise<void> {
  try {
    await fetch(apiUrl('/api/auth/logout'), {
      method: 'POST',
      credentials: 'include'
    });
  } catch {
    // 网络错误忽略，本地状态依然清理
  }
}

function handleUnauthorized() {
  sessionStorage.setItem('auth-expired', '1');
  clearStoredUser();
  window.dispatchEvent(new Event('auth-changed'));
  // 异步清除 Cookie 后跳转，不阻塞
  void clearAuthCookie();
  window.location.href = '/login';
}

const AUTH_NO_REDIRECT_PATHS = ['/api/auth/login', '/api/auth/register'];

export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  // credentials: 'include' 让浏览器自动携带 httpOnly Cookie
  const res = await fetch(url, { ...options, credentials: 'include' });
  // 登录/注册被拒返回的 401 是业务错误（密码错误等），不应触发"认证过期"全局跳转
  const isAuthPath = AUTH_NO_REDIRECT_PATHS.some((p) => url.includes(p));
  if (res.status === 401 && !isAuthPath) {
    handleUnauthorized();
    throw new Error('认证已过期，请重新登录');
  }
  // 403 不在此处理：可能是 admin-only 路径或被封账户，由调用方根据 detail 区分
  return res;
}

export function apiUrl(path: string): string {
  return `${GATEWAY_URL}${path}`;
}

/** 携带后端 detail 信息的错误，便于上层根据 detail.ban_reason 等做精确展示 */
export class ApiError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const res = await apiFetch(apiUrl(path), options);
  const payload = await parsePayload(res);
  if (!res.ok) {
    const err = payload as { detail?: { message?: string }; message?: string };
    throw new ApiError(
      res.status,
      err?.detail?.message || err?.message || '请求失败',
      (payload as { detail?: unknown })?.detail
    );
  }
  return payload as ApiResponse<T>;
}

export function apiGet<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  return request<T>(path, options);
}

export function apiSend<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<ApiResponse<T>> {
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export function apiPost<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  return apiSend<T>(path, 'POST', body);
}

export function apiPut<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  return apiSend<T>(path, 'PUT', body);
}

export function apiDelete<T>(path: string): Promise<ApiResponse<T>> {
  return apiSend<T>(path, 'DELETE');
}

export async function parsePayload(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** 从错误中提取结构化封禁信息；非封禁错误返回 null */
export function extractBanInfo(err: unknown): { ban_reason: string | null; banned_until: string | null } | null {
  if (!(err instanceof ApiError) || err.status !== 403) return null;
  const detail = err.detail as { ban_reason?: string | null; banned_until?: string | null } | undefined;
  if (!detail || typeof detail !== 'object') return null;
  // account banned 错误：detail 含 ban_reason / banned_until
  if ('ban_reason' in detail || 'banned_until' in detail) {
    return {
      ban_reason: detail.ban_reason ?? null,
      banned_until: detail.banned_until ?? null
    };
  }
  return null;
}

/** 格式化封禁提示文本，用于登录页与全局 403 提示 */
export function formatBanMessage(info: { ban_reason: string | null; banned_until: string | null }): string {
  const parts: string[] = ['账号已被封禁'];
  if (info.ban_reason) parts.push(`原因：${info.ban_reason}`);
  if (info.banned_until) {
    try {
      const d = new Date(info.banned_until);
      parts.push(`解封时间：${d.toLocaleString()}`);
    } catch {
      parts.push(`解封时间：${info.banned_until}`);
    }
  } else {
    parts.push('解封时间：永久（联系管理员）');
  }
  return parts.join(' · ');
}
