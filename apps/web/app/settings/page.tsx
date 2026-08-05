"use client";

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut, getErrorMessage, writeStoredUser } from '../lib/api';
import type { UserInfo } from '../lib/types';
import AuthGate from '../components/AuthGate';
import { useAuth } from '../hooks/useAuth';
import { Spinner } from '../components/ui';

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsInner />
    </AuthGate>
  );
}

type Visibility = 'public' | 'hidden' | 'self';

interface ProfileModule {
  key: string;
  label: string;
  desc: string;
}

const PROFILE_MODULES: ProfileModule[] = [
  { key: 'heatmap', label: 'AC 热力图', desc: '近 90 天 AC 热力图' },
  { key: 'solved', label: '已 AC 题目', desc: '通过题目列表' },
  { key: 'messages', label: '留言板', desc: '访客留言与展示' },
  { key: 'social', label: '粉丝 / 关注', desc: '关注与粉丝统计' },
  { key: 'badges', label: '徽章展示', desc: '已获得成就徽章' }
];

const VISIBILITY_OPTIONS: Array<{ value: Visibility; label: string; desc: string }> = [
  { value: 'public', label: '所有人可见', desc: '任何访客都能看到' },
  { value: 'self', label: '仅自己可见', desc: '只有你自己登录后能看到' },
  { value: 'hidden', label: '隐藏', desc: '所有人（包括自己）都看不到' }
];

function SettingsInner() {
  const { user } = useAuth();

  const [username, setUsername] = useState(user?.username || '');
  const [usernameMsg, setUsernameMsg] = useState('');
  const [usernameType, setUsernameType] = useState<'info' | 'error' | 'success'>('info');
  const [usernameBusy, setUsernameBusy] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdType, setPwdType] = useState<'info' | 'error' | 'success'>('info');
  const [pwdBusy, setPwdBusy] = useState(false);

  const [modules, setModules] = useState<Record<string, Visibility> | null>(null);
  const [modMsg, setModMsg] = useState('');
  const [modType, setModType] = useState<'info' | 'error' | 'success'>('info');
  const [modBusy, setModBusy] = useState(false);

  const loadModules = useCallback(async () => {
    try {
      const payload = await apiGet<{ modules: Record<string, Visibility> }>('/api/users/me/home-modules');
      setModules(payload.data.modules);
    } catch {
      setModules(null);
    }
  }, []);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  async function saveModules() {
    if (!modules) return;
    setModBusy(true);
    setModMsg('');
    try {
      const payload = await apiPut<{ modules: Record<string, Visibility> }>('/api/users/me/home-modules', {
        modules
      });
      setModules(payload.data.modules);
      setModMsg('公开主页模块设置已保存');
      setModType('success');
    } catch (err: unknown) {
      setModMsg(getErrorMessage(err, '保存失败'));
      setModType('error');
    } finally {
      setModBusy(false);
    }
  }

  function msgStyle(type: 'info' | 'error' | 'success') {
    return type === 'error'
      ? { color: '#cf222e' }
      : type === 'success'
        ? { color: '#1a7f37' }
        : { color: '#656d76' };
  }

  async function onProfileSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      setUsernameMsg('用户名不能为空');
      setUsernameType('error');
      return;
    }
    if (trimmed === user?.username) {
      setUsernameMsg('用户名没有变化');
      setUsernameType('info');
      return;
    }
    setUsernameBusy(true);
    try {
      const payload = await apiPut<UserInfo>('/api/users/me/profile', { username: trimmed });
      writeStoredUser(payload.data);
      window.dispatchEvent(new Event('auth-changed'));
      setUsernameMsg('用户名已更新');
      setUsernameType('success');
    } catch (err: unknown) {
      setUsernameMsg(getErrorMessage(err, '更新失败'));
      setUsernameType('error');
    } finally {
      setUsernameBusy(false);
    }
  }

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (!oldPassword) {
      setPwdMsg('请输入当前密码');
      setPwdType('error');
      return;
    }
    if (newPassword.length < 6) {
      setPwdMsg('新密码至少 6 位');
      setPwdType('error');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdMsg('两次输入的新密码不一致');
      setPwdType('error');
      return;
    }
    setPwdBusy(true);
    try {
      await apiPut<{ updated: boolean }>('/api/users/me/password', {
        old_password: oldPassword,
        new_password: newPassword
      });
      setPwdMsg('密码已修改');
      setPwdType('success');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setPwdMsg(getErrorMessage(err, '修改失败'));
      setPwdType('error');
    } finally {
      setPwdBusy(false);
    }
  }

  return (
    <main className="container">
      <h1>设置</h1>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>个人资料</h2>
        <form onSubmit={onProfileSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: '#656d76' }}>用户名</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="3-50 位字母、数字、下划线或中文"
            style={{ width: 260 }}
            aria-label="用户名"
          />
          <button type="submit" className="btn btn-secondary" disabled={usernameBusy}>
            {usernameBusy ? '保存中...' : '保存'}
          </button>
        </form>
        {usernameMsg && <p style={{ marginBottom: 0, ...msgStyle(usernameType) }}>{usernameMsg}</p>}
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>公开主页模块</h2>
        <p style={{ fontSize: 13, color: '#656d76', marginTop: 0 }}>
          控制 <code>/users/你的用户名</code> 主页各模块的可见性
        </p>
        {modules === null ? (
          <Spinner label="加载模块设置中..." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {PROFILE_MODULES.map((m) => (
              <div key={m.key} style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{m.label}</div>
                <div style={{ fontSize: 12, color: '#656d76', margin: '2px 0 8px' }}>{m.desc}</div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={`module-${m.key}`}
                        value={opt.value}
                        checked={(modules[m.key] ?? 'public') === opt.value}
                        onChange={() => setModules((prev) => (prev ? { ...prev, [m.key]: opt.value } : prev))}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <button type="button" className="btn" disabled={modBusy} onClick={() => void saveModules()}>
                {modBusy ? '保存中...' : '保存模块设置'}
              </button>
            </div>
          </div>
        )}
        {modMsg && <p style={{ marginBottom: 0, ...msgStyle(modType) }}>{modMsg}</p>}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>修改密码</h2>
        <form onSubmit={onPasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
          <input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            placeholder="当前密码"
            aria-label="当前密码"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="新密码（至少 6 位）"
            aria-label="新密码"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="确认新密码"
            aria-label="确认新密码"
          />
          <div>
            <button type="submit" className="btn btn-secondary" disabled={pwdBusy}>
              {pwdBusy ? '修改中...' : '修改密码'}
            </button>
          </div>
        </form>
        {pwdMsg && <p style={{ marginBottom: 0, ...msgStyle(pwdType) }}>{pwdMsg}</p>}
      </section>
    </main>
  );
}
