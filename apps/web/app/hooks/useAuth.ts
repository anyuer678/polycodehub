"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  getStoredUserSnapshot,
  writeStoredUser,
  clearStoredUser,
  apiUrl,
  apiPost
} from '../lib/api';
import type { UserInfo } from '../lib/types';

export type { UserInfo };

function subscribeToAuth(cb: () => void): () => void {
  window.addEventListener('storage', cb);
  window.addEventListener('auth-changed', cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener('auth-changed', cb);
  };
}

/**
 * 认证 Hook：token 现存储在 httpOnly Cookie（JS 不可读），
 * 本 Hook 只负责：
 * 1. 通过 useSyncExternalStore 同步本地缓存的 UserInfo（非敏感，仅用于 UI）
 * 2. 挂载时调用 /api/auth/verify 恢复登录态（Cookie 自动携带）
 * 3. login/logout 操作触发 auth-changed 事件
 */
export function useAuth() {
  const user = useSyncExternalStore(subscribeToAuth, () => getStoredUserSnapshot(), () => null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setVerifying(true);
    // verify 通过 Cookie 自动鉴权，无需手动传 token
    fetch(`${apiUrl('/api/auth/verify')}`, {
      credentials: 'include'
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const payload = (await res.json()) as { data?: UserInfo };
          if (payload?.data) {
            writeStoredUser(payload.data);
            window.dispatchEvent(new Event('auth-changed'));
          }
        } else if (res.status === 401) {
          // Cookie 过期或不存在：清理本地缓存的用户信息
          clearStoredUser();
          window.dispatchEvent(new Event('auth-changed'));
        } else if (res.status === 403) {
          // 账号被封禁：提取 detail 中的封禁信息写入 sessionStorage 供登录页展示
          try {
            const payload = (await res.json()) as { detail?: { ban_reason?: string | null; banned_until?: string | null } };
            const detail = payload?.detail;
            if (detail && (detail.ban_reason !== undefined || detail.banned_until !== undefined)) {
              sessionStorage.setItem('ban-info', JSON.stringify({
                ban_reason: detail.ban_reason ?? null,
                banned_until: detail.banned_until ?? null
              }));
            }
          } catch {
            // 解析失败也走清理流程
          }
          clearStoredUser();
          window.dispatchEvent(new Event('auth-changed'));
          // 跳转登录页让用户看到封禁提示
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // login 不再接收 token 参数：网关在 /api/auth/login 响应中已设置 httpOnly Cookie，
  // 前端只需保存返回的 UserInfo 用于 UI 展示。
  const login = useCallback((userInfo: UserInfo) => {
    writeStoredUser(userInfo);
    window.dispatchEvent(new Event('auth-changed'));
  }, []);

  const logout = useCallback(async () => {
    // 调用服务端清除 Cookie
    try {
      await apiPost('/api/auth/logout', {});
    } catch {
      // 忽略网络错误，仍清理本地状态
    }
    clearStoredUser();
    window.dispatchEvent(new Event('auth-changed'));
  }, []);

  return {
    user,
    isLoggedIn: user !== null,
    isAdmin: user?.role === 'admin',
    isStaff: user?.role === 'admin' || user?.role === 'teacher',
    isTeacher: user?.role === 'teacher',
    verifying,
    login,
    logout
  };
}
