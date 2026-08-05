"use client";

import { useState } from 'react';
import { apiPost, getErrorMessage } from '../../lib/api';
import AuthGate from '../../components/AuthGate';
import AdminPage from '../../components/AdminPage';
import UserPicker, { type PickedUser } from '../../components/UserPicker';

const NOTIF_TYPES = [
  { value: 'system', label: '系统' },
  { value: 'announcement', label: '公告' },
  { value: 'submission', label: '判题' },
  { value: 'other', label: '其他' }
];

export default function AdminNotificationsPage() {
  return (
    <AuthGate admin>
      <AdminNotificationsInner />
    </AuthGate>
  );
}

function AdminNotificationsInner() {
  const [mode, setMode] = useState<'broadcast' | 'single'>('broadcast');
  const [pickedUser, setPickedUser] = useState<PickedUser | null>(null);
  const [type, setType] = useState('system');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');

  async function onSend() {
    if (!title.trim()) {
      setMessage('请输入标题');
      setMessageType('error');
      return;
    }
    if (mode === 'single' && !pickedUser) {
      setMessage('请选择接收通知的用户');
      setMessageType('error');
      return;
    }

    const body: Record<string, unknown> = { type, title: title.trim(), content };
    if (mode === 'broadcast') {
      body.broadcast = true;
    } else {
      body.user_id = pickedUser!.id;
    }

    setBusy(true);
    try {
      const res = await apiPost<{ sent?: number; id?: number; broadcast?: boolean }>(
        '/api/admin/notifications',
        body
      );
      if (res.data.broadcast) {
        setMessage(`已群发给 ${res.data.sent ?? 0} 位用户`);
      } else {
        setMessage(`已发送通知（id: ${res.data.id}）`);
      }
      setMessageType('success');
      // 发送成功后清空表单
      setTitle('');
      setContent('');
      setPickedUser(null);
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '发送失败'));
      setMessageType('error');
    } finally {
      setBusy(false);
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
      title="站内信（管理员）"
      subtitle="向用户推送通知，可选择群发所有用户或发送给指定用户"
    >
      <section className="card">
        <h3>收件人</h3>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'broadcast'}
              onChange={() => setMode('broadcast')}
            />
            群发所有用户
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'single'}
              onChange={() => setMode('single')}
            />
            指定用户
          </label>
        </div>
        {mode === 'single' && (
          <p>
            <label>接收用户</label>
            <br />
            <UserPicker
              selected={pickedUser}
              onSelect={setPickedUser}
              placeholder="输入用户名或邮箱搜索..."
            />
          </p>
        )}

        <h3 style={{ marginTop: 16 }}>通知内容</h3>
        <p>
          <label>类型</label>
          <br />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: '100%' }}>
            {NOTIF_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </p>
        <p>
          <label>标题</label>
          <br />
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="通知标题（必填）"
            maxLength={255}
            style={{ width: '100%' }}
          />
        </p>
        <p>
          <label>内容（可选）</label>
          <br />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="通知正文..."
            rows={5}
            maxLength={2000}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </p>
        <button className="btn" type="button" disabled={busy} onClick={() => void onSend()}>
          {busy ? '发送中...' : '发送通知'}
        </button>
      </section>

      {message && <p style={{ marginTop: 12, ...messageStyle }}>{message}</p>}
    </AdminPage>
  );
}
