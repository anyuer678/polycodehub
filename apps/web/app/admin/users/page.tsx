"use client";

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut, getErrorMessage } from '../../lib/api';
import type { AdminUser, ListResponse } from '../../lib/types';
import { Spinner } from '../../components/ui';
import AuthGate from '../../components/AuthGate';
import AdminPage from '../../components/AdminPage';

export default function AdminUsersPage() {
  return (
    <AuthGate admin>
      <AdminUsersInner />
    </AuthGate>
  );
}

function AdminUsersInner() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');
  // 封禁对话框：banTarget 非 null 时展示模态
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);
  const [banReason, setBanReason] = useState('');
  // 封禁模式：permanent 永久封禁；limited 限时封禁至 banUntil（datetime-local 字符串）
  const [banMode, setBanMode] = useState<'permanent' | 'limited'>('permanent');
  const [banUntil, setBanUntil] = useState('');
  const [banSubmitting, setBanSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(15) });
      if (search) params.set('search', search);
      if (role) params.set('role', role);
      const payload = await apiGet<ListResponse<AdminUser>>(`/api/admin/users?${params}`);
      setItems(payload.data.items);
      setTotal(payload.data.total);
      setMessage('');
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '加载失败'));
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }, [page, search, role]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(keyword.trim());
  }

  async function updateUser(user: AdminUser, changes: { role?: string; banned?: boolean; ban_reason?: string; banned_until?: string | null }) {
    setBusy(`u-${user.id}`);
    try {
      await apiPut<AdminUser>(`/api/admin/users/${user.id}`, changes);
      setMessage(`已更新用户 ${user.username}`);
      setMessageType('success');
      await load();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '操作失败'));
      setMessageType('error');
    } finally {
      setBusy(null);
    }
  }

  // 把 ISO/datetime-local 默认值生成为本地 datetime-local 字符串：默认 now + 1 天，取整到小时
  function defaultBanUntil(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openBanDialog(user: AdminUser) {
    setBanTarget(user);
    setBanReason('');
    setBanMode('permanent');
    setBanUntil(defaultBanUntil());
    setBanSubmitting(false);
  }

  function closeBanDialog() {
    setBanTarget(null);
    setBanReason('');
    setBanMode('permanent');
    setBanUntil('');
    setBanSubmitting(false);
  }

  async function submitBan() {
    if (!banTarget) return;
    // 构造 banned_until：permanent → null；limited → ISO 字符串
    let banned_until: string | null = null;
    if (banMode === 'limited') {
      if (!banUntil) {
        setMessage('请选择封禁结束时间');
        setMessageType('error');
        return;
      }
      const d = new Date(banUntil);
      if (isNaN(d.getTime())) {
        setMessage('封禁结束时间格式无效');
        setMessageType('error');
        return;
      }
      if (d.getTime() <= Date.now()) {
        setMessage('封禁结束时间必须晚于当前时间');
        setMessageType('error');
        return;
      }
      banned_until = d.toISOString();
    }
    setBanSubmitting(true);
    try {
      await apiPut<AdminUser>(`/api/admin/users/${banTarget.id}`, {
        banned: true,
        // 关键修复：原因留空时不发 ban_reason 字段（undefined），而非 null。
        // UpdateUserSchema 仅接受 string|undefined，传 null 会触发 validation failed。
        ban_reason: banReason.trim() || undefined,
        banned_until
      });
      setMessage(`已封禁用户 ${banTarget.username}`);
      setMessageType('success');
      closeBanDialog();
      await load();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '封禁失败'));
      setMessageType('error');
    } finally {
      setBanSubmitting(false);
    }
  }

  const messageStyle =
    messageType === 'error'
      ? { color: '#cf222e' }
      : messageType === 'success'
        ? { color: '#1a7f37' }
        : { color: '#656d76' };

  return (
    <AdminPage
      title="用户管理（管理员）"
      subtitle={`共 ${total} 位用户 · 封禁立即生效；限时封禁到期自动解封`}
    >

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <form onSubmit={onSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索用户名或邮箱..."
            style={{ width: 220 }}
            aria-label="搜索用户"
          />
          <button type="submit" className="btn btn-secondary">搜索</button>
        </form>
        <select
          value={role}
          onChange={(e) => { setRole(e.target.value); setPage(1); }}
          aria-label="按角色筛选"
          style={{ width: 130 }}
        >
          <option value="">全部角色</option>
          <option value="user">普通用户</option>
          <option value="teacher">教师</option>
          <option value="admin">管理员</option>
        </select>
      </div>

      {loading && <Spinner label="加载用户中..." />}
      {!loading && items.length === 0 && <p>未找到用户</p>}
      {!loading && items.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 56 }}>ID</th>
                  <th>用户名</th>
                  <th>邮箱</th>
                  <th style={{ width: 80 }}>角色</th>
                  <th style={{ width: 70 }}>提交</th>
                  <th style={{ width: 70 }}>AC</th>
                  <th style={{ width: 280 }}>封禁状态</th>
                  <th style={{ width: 200 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => {
                  const banActive = u.banned && (!u.banned_until || new Date(u.banned_until).getTime() > Date.now());
                  return (
                    <tr key={u.id} style={u.banned ? { opacity: 0.65 } : undefined}>
                      <td style={{ color: '#656d76' }}>{u.id}</td>
                      <td>
                        <b>{u.username}</b>
                      </td>
                      <td style={{ color: '#656d76', fontSize: 13 }}>{u.email}</td>
                      <td>
                        <span className="badge" style={{ background: u.role === 'admin' ? '#ddf4ff' : u.role === 'teacher' ? '#fff8c5' : '#f6f8fa', color: u.role === 'admin' ? '#0969da' : u.role === 'teacher' ? '#7d4e00' : '#57606a' }}>
                          {u.role === 'admin' ? '管理员' : u.role === 'teacher' ? '教师' : '用户'}
                        </span>
                      </td>
                      <td style={{ color: '#656d76' }}>{u.submission_count}</td>
                      <td style={{ color: '#1a7f37', fontWeight: 600 }}>{u.ac_count}</td>
                      <td>
                        {u.banned ? (
                          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                            <span
                              className="badge"
                              style={{
                                background: banActive ? '#ffebe9' : '#fff8c5',
                                color: banActive ? '#cf222e' : '#7d4e00',
                                marginRight: 6
                              }}
                            >
                              {banActive ? '封禁中' : '已过期'}
                            </span>
                            {u.ban_reason && (
                              <div style={{ color: '#57606a', marginTop: 2 }}>
                                原因：{u.ban_reason}
                              </div>
                            )}
                            <div style={{ color: '#656d76' }}>
                              {u.banned_until
                                ? `至 ${new Date(u.banned_until).toLocaleString()}`
                                : '永久封禁'}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#656d76', fontSize: 12 }}>正常</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {u.role === 'user' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={busy === `u-${u.id}`}
                              style={{ marginRight: 6 }}
                              onClick={() => void updateUser(u, { role: 'teacher' })}
                            >
                              设为教师
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={busy === `u-${u.id}`}
                              style={{ marginRight: 6 }}
                              onClick={() => void updateUser(u, { role: 'admin' })}
                            >
                              设为管理员
                            </button>
                          </>
                        )}
                        {u.role === 'teacher' && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy === `u-${u.id}`}
                            style={{ marginRight: 6 }}
                            onClick={() => void updateUser(u, { role: 'user' })}
                          >
                            取消教师
                          </button>
                        )}
                        {u.role === 'admin' && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy === `u-${u.id}`}
                            style={{ marginRight: 6 }}
                            onClick={() => void updateUser(u, { role: 'user' })}
                          >
                            取消管理
                          </button>
                        )}
                        {!u.banned ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busy === `u-${u.id}`}
                            onClick={() => openBanDialog(u)}
                          >
                            封禁
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy === `u-${u.id}`}
                            onClick={() => void updateUser(u, { banned: false })}
                          >
                            解封
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {banTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ban-dialog-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={closeBanDialog}
        >
          <div
            className="card"
            style={{ width: 420, margin: 0, padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="ban-dialog-title" style={{ margin: '0 0 8px', fontSize: 17 }}>
              封禁用户 {banTarget.username}
            </h3>
            <p style={{ margin: '0 0 16px', color: '#656d76', fontSize: 13 }}>
              封禁后该用户将无法登录与访问受保护接口。
            </p>
            <div className="input-group">
              <label className="field-label" htmlFor="ban-reason">封禁原因（可选）</label>
              <textarea
                id="ban-reason"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="例如：刷分、违规行为..."
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
                maxLength={500}
              />
            </div>
            <div className="input-group">
              <label className="field-label">封禁时长</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="radio"
                    name="ban-mode"
                    checked={banMode === 'permanent'}
                    onChange={() => setBanMode('permanent')}
                  />
                  永久封禁（需管理员手动解封）
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="radio"
                    name="ban-mode"
                    checked={banMode === 'limited'}
                    onChange={() => setBanMode('limited')}
                  />
                  限时封禁至
                </label>
                {banMode === 'limited' && (
                  <input
                    type="datetime-local"
                    value={banUntil}
                    onChange={(e) => setBanUntil(e.target.value)}
                    style={{ width: '100%' }}
                    aria-label="封禁结束时间"
                  />
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={closeBanDialog} disabled={banSubmitting}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void submitBan()}
                disabled={banSubmitting}
              >
                {banSubmitting ? '处理中...' : '确认封禁'}
              </button>
            </div>
          </div>
        </div>
      )}

      {total > 15 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span style={{ alignSelf: 'center', fontSize: 13, color: '#656d76' }}>
            第 {page} / {Math.ceil(total / 15)} 页
          </span>
          <button className="btn btn-secondary btn-sm" type="button" disabled={page * 15 >= total} onClick={() => setPage(page + 1)}>
            下一页
          </button>
        </div>
      )}

      {message && <p style={{ marginTop: 12, ...messageStyle }}>{message}</p>}
    </AdminPage>
  );
}
