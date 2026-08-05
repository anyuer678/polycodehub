"use client";

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, getErrorMessage } from '../../lib/api';
import type { Announcement, ListResponse } from '../../lib/types';
import { Spinner, EmptyState } from '../../components/ui';
import AuthGate from '../../components/AuthGate';
import AdminPage from '../../components/AdminPage';

// 预定义公告分类
const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'general', label: '常规' },
  { value: 'system', label: '系统' },
  { value: 'contest', label: '比赛' },
  { value: 'maintenance', label: '维护' },
  { value: 'feature', label: '功能' }
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label])
);

// ISO <-> datetime-local 互转
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function AdminAnnouncementsPage() {
  return (
    <AuthGate admin>
      <AdminAnnouncementsInner />
    </AuthGate>
  );
}

function AdminAnnouncementsInner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [category, setCategory] = useState('general');
  const [expiresAt, setExpiresAt] = useState(''); // datetime-local 字符串
  const [editId, setEditId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editPinned, setEditPinned] = useState(false);
  const [editCategory, setEditCategory] = useState('general');
  const [editExpiresAt, setEditExpiresAt] = useState(''); // datetime-local；空表示清空
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiGet<ListResponse<Announcement>>('/api/admin/announcements');
      setItems(payload.data.items);
      setMessage('');
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '加载失败'));
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy('create');
    try {
      const body: Record<string, unknown> = {
        title,
        content,
        is_active: isActive,
        pinned,
        category
      };
      if (expiresAt) body.expires_at = localInputToIso(expiresAt);
      await apiPost<Announcement>('/api/admin/announcements', body);
      setMessage('公告创建成功');
      setMessageType('success');
      setTitle('');
      setContent('');
      setIsActive(true);
      setPinned(false);
      setCategory('general');
      setExpiresAt('');
      await load();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '创建失败'));
      setMessageType('error');
    } finally {
      setBusy(null);
    }
  }

  function openEdit(a: Announcement) {
    setEditId(a.id);
    setEditTitle(a.title);
    setEditContent(a.content);
    setEditActive(a.is_active);
    setEditPinned(Boolean(a.pinned));
    setEditCategory(a.category || 'general');
    setEditExpiresAt(isoToLocalInput(a.expires_at));
  }

  async function onSaveEdit() {
    if (!editId) return;
    setBusy('edit');
    try {
      // expires_at: 空串传 null 清空；非空转 ISO；不传 undefined 表示不更新
      const expiresPayload = editExpiresAt ? localInputToIso(editExpiresAt) : null;
      await apiPut<Announcement>(`/api/admin/announcements/${editId}`, {
        title: editTitle,
        content: editContent,
        is_active: editActive,
        pinned: editPinned,
        category: editCategory,
        expires_at: expiresPayload
      });
      setMessage(`公告 #${editId} 已更新`);
      setMessageType('success');
      setEditId(null);
      await load();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '更新失败'));
      setMessageType('error');
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm(`确认删除公告 #${id} 吗？`)) return;
    setBusy(`del-${id}`);
    try {
      await apiDelete(`/api/admin/announcements/${id}`);
      setMessage('公告已删除');
      setMessageType('success');
      await load();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '删除失败'));
      setMessageType('error');
    } finally {
      setBusy(null);
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
      title="公告管理（管理员）"
      subtitle="启用中的公告显示在历史页；置顶公告同时显示在个人中心横幅；过期公告自动隐藏"
    >

      <form className="card" onSubmit={onCreate}>
        <h3>发布公告</h3>
        <p>
          <label>标题</label><br />
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={255} style={{ width: '100%' }} />
        </p>
        <p>
          <label>内容</label><br />
          <textarea className="textarea-full" value={content} onChange={(e) => setContent(e.target.value)} rows={5} required />
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 8 }}>
          <p>
            <label>分类</label><br />
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%' }}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </p>
          <p>
            <label>过期时间（留空表示永久）</label><br />
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              style={{ width: '100%' }}
            />
          </p>
        </div>
        <p style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            立即启用
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            置顶（显示在个人中心横幅）
          </label>
        </p>
        <button type="submit" className="btn" disabled={busy === 'create'}>发布</button>
      </form>

      <section className="card">
        <h3>公告列表</h3>
        {loading ? (
          <Spinner label="加载公告中..." />
        ) : items.length === 0 ? (
          <EmptyState text="暂无公告" />
        ) : (
          items.map((a) => {
            const expired = a.expires_at ? new Date(a.expires_at).getTime() <= Date.now() : false;
            return (
              <div key={a.id} className="fade-in divider">
                <p style={{ margin: '4px 0' }}>
                  <b>#{a.id}</b> {a.title}
                  {a.pinned && (
                    <span className="badge" style={{ marginLeft: 8, background: '#fff8c5', color: '#7d4e00', borderColor: '#d4a72c' }}>
                      置顶
                    </span>
                  )}
                  {a.is_active
                    ? <span className="badge badge-ac" style={{ marginLeft: 8 }}>启用</span>
                    : <span className="badge" style={{ marginLeft: 8 }}>停用</span>}
                  {expired && (
                    <span className="badge" style={{ marginLeft: 8, background: '#ffebe9', color: '#cf222e' }}>已过期</span>
                  )}
                  {a.category && (
                    <span className="badge" style={{ marginLeft: 8, background: '#f6f8fa', color: '#57606a' }}>
                      {CATEGORY_LABEL[a.category] || a.category}
                    </span>
                  )}
                  <span style={{ float: 'right', color: '#656d76', fontSize: 12 }}>
                    发布者：{a.creator_name || '未知'} · {a.updated_at ? new Date(a.updated_at).toLocaleString() : '-'}
                  </span>
                </p>
                <p style={{ color: '#363a42', fontSize: 13, whiteSpace: 'pre-wrap', margin: '4px 0 8px' }}>{a.content}</p>
                {a.expires_at && (
                  <p style={{ color: '#656d76', fontSize: 12, margin: '4px 0 8px' }}>
                    过期时间：{new Date(a.expires_at).toLocaleString()}
                  </p>
                )}
                <button className="btn btn-sm" type="button" onClick={() => openEdit(a)} style={{ marginRight: 8 }}>
                  编辑
                </button>
                <button className="btn btn-danger btn-sm" type="button" disabled={busy === `del-${a.id}`} onClick={() => void onDelete(a.id)}>
                  删除
                </button>
              </div>
            );
          })
        )}
      </section>

      {editId && (
        <section className="card fade-in">
          <h3>编辑公告 #{editId}</h3>
          <p>
            <label>标题</label><br />
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={{ width: '100%' }} />
          </p>
          <p>
            <label>内容</label><br />
            <textarea className="textarea-full" value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={5} />
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 8 }}>
            <p>
              <label>分类</label><br />
              <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)} style={{ width: '100%' }}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </p>
            <p>
              <label>过期时间（清空表示永久）</label><br />
              <input
                type="datetime-local"
                value={editExpiresAt}
                onChange={(e) => setEditExpiresAt(e.target.value)}
                style={{ width: '100%' }}
              />
            </p>
          </div>
          <p style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
              启用
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={editPinned} onChange={(e) => setEditPinned(e.target.checked)} />
              置顶
            </label>
          </p>
          <button className="btn" type="button" disabled={busy === 'edit'} onClick={() => void onSaveEdit()} style={{ marginRight: 8 }}>
            保存
          </button>
          <button className="btn" type="button" onClick={() => setEditId(null)}>取消</button>
        </section>
      )}

      {message && <p style={{ marginTop: 12, ...messageStyle }}>{message}</p>}
    </AdminPage>
  );
}
