"use client";

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiPost, getErrorMessage } from '../lib/api';
import type { UserInfo } from '../lib/types';
import { useAuth } from '../hooks/useAuth';
import { LoadingButton, PasswordField } from '../components/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{3,50}$/.test(username)) {
      setError('用户名需为 3-50 位字母、数字、下划线或中文');
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);

    try {
      const payload = await apiPost<{ token: string; user: UserInfo }>('/api/auth/register', {
        email,
        username,
        password
      });
      // token 由网关写入 httpOnly Cookie，前端只保存 UserInfo 用于 UI
      login(payload.data.user);
      router.push('/problems');
      router.refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err, '网络错误，请稍后再试'));
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
          <h1 style={{ fontSize: 20, margin: '14px 0 4px' }}>注册 PolyCodeHub</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#656d76' }}>创建账号，开始刷题</p>
        </div>

        <form onSubmit={onSubmit}>
          <div className="input-group">
            <label className="field-label" htmlFor="username">用户名</label>
            <input
              id="username"
              style={{ width: '100%' }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              placeholder="3-50 位字母、数字、下划线或中文"
            />
          </div>
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
              autoComplete="new-password"
              placeholder="至少 6 位"
            />
          </div>
          <div className="input-group">
            <PasswordField
              id="confirm"
              label="确认密码"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              placeholder="再次输入密码"
            />
          </div>
          {error && (
            <p className="error" role="alert" style={{ margin: '0 0 12px', fontSize: 13 }}>
              {error}
            </p>
          )}
          <LoadingButton loading={loading} type="submit" style={{ width: '100%' }}>
            注册
          </LoadingButton>
        </form>

        <p style={{ textAlign: 'center', margin: '16px 0 0', fontSize: 13, color: '#656d76' }}>
          已有账号？
          <Link href="/login" style={{ color: '#0969da', marginLeft: 4 }}>
            直接登录
          </Link>
        </p>
      </div>
    </main>
  );
}