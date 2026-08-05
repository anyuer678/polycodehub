"use client";

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiPost, getErrorMessage, extractBanInfo, formatBanMessage } from '../lib/api';
import type { UserInfo } from '../lib/types';
import { useAuth } from '../hooks/useAuth';
import { LoadingButton, PasswordField } from '../components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [banInfo, setBanInfo] = useState<{ ban_reason: string | null; banned_until: string | null } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('auth-expired')) {
      sessionStorage.removeItem('auth-expired');
      setError('登录已过期，请重新登录');
    }
    // 从 sessionStorage 读取 useAuth 在 403 时写入的封禁信息
    const rawBan = sessionStorage.getItem('ban-info');
    if (rawBan) {
      sessionStorage.removeItem('ban-info');
      try {
        setBanInfo(JSON.parse(rawBan));
      } catch {
        // ignore
      }
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setBanInfo(null);

    try {
      const payload = await apiPost<{ token: string; user: UserInfo }>('/api/auth/login', { email, password });
      // token 由网关写入 httpOnly Cookie，前端只保存 UserInfo 用于 UI
      login(payload.data.user);
      router.push('/problems');
      router.refresh();
    } catch (err: unknown) {
      // 封号透明化：登录被拒时优先展示封禁原因
      const bi = extractBanInfo(err);
      if (bi) {
        setBanInfo(bi);
        setError('');
      } else {
        setError(getErrorMessage(err, '网络错误，请稍后再试'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <div
        className="card fade-in"
        style={{
          maxWidth: 400,
          margin: '40px auto',
          padding: 28
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span className="brand-mark" aria-hidden="true" style={{ width: 40, height: 40, fontSize: 20 }}>
            P
          </span>
          <h1 style={{ fontSize: 20, margin: '14px 0 4px' }}>登录 PolyCodeHub</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#656d76' }}>继续你的刷题之旅</p>
        </div>

        <form onSubmit={onSubmit}>
          <div className="input-group">
            <label className="field-label" htmlFor="email">邮箱</label>
            <input
              id="email"
              type="email"
              style={{ width: '100%' }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>
          <div className="input-group">
            <PasswordField
              id="password"
              label="密码"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </div>
          <div className="remember-row">
            <span className="remember-label" style={{ fontSize: 12, color: '#656d76' }}>
              登录状态由服务端 Cookie 管理（1 天有效）
            </span>
          </div>
          {banInfo && (
            <div
              role="alert"
              style={{
                margin: '0 0 12px',
                padding: '10px 12px',
                background: '#ffebe9',
                border: '1px solid #ff8182',
                borderRadius: 6,
                color: '#cf222e',
                fontSize: 13,
                lineHeight: 1.6
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>⛔ {formatBanMessage(banInfo)}</div>
              <div style={{ fontSize: 12, color: '#82071e' }}>
                如有异议，请联系管理员申诉。
              </div>
            </div>
          )}
          {error && (
            <p className="error" role="alert" style={{ margin: '0 0 12px', fontSize: 13 }}>
              {error}
            </p>
          )}
          <LoadingButton loading={loading} type="submit" style={{ width: '100%' }}>
            登录
          </LoadingButton>
        </form>

        <p style={{ textAlign: 'center', margin: '16px 0 0', fontSize: 13, color: '#656d76' }}>
          还没有账号？
          <Link href="/register" style={{ color: '#0969da', marginLeft: 4 }}>
            立即注册
          </Link>
        </p>
      </div>
    </main>
  );
}