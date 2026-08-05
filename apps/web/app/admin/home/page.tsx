"use client";

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut, getErrorMessage } from '../../lib/api';
import { Spinner } from '../../components/ui';
import AuthGate from '../../components/AuthGate';
import AdminPage from '../../components/AdminPage';

interface ModuleItem {
  key: string;
  label: string;
  enabled: boolean;
}

export default function AdminHomePage() {
  return (
    <AuthGate admin>
      <AdminHomeInner />
    </AuthGate>
  );
}

function AdminHomeInner() {
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiGet<{ modules: ModuleItem[] }>('/api/home-modules');
      setModules(payload.data.modules);
    } catch {
      // 加载失败不阻塞
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(key: string) {
    setModules((prev) => prev.map((m) => (m.key === key ? { ...m, enabled: !m.enabled } : m)));
  }

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, boolean> = {};
      for (const m of modules) payload[m.key] = m.enabled;
      await apiPut('/api/admin/home-modules', { modules: payload });
      setMessage('首页模块设置已保存');
      setMessageType('success');
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '保存失败'));
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
      title="首页设置"
      subtitle="选择要在首页展示的模块，保存后立即生效"
    >
      {loading ? (
        <Spinner label="加载中..." />
      ) : (
        <section className="card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {modules.map((m) => (
              <label
                key={m.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  border: '1px solid #d0d7de',
                  borderRadius: 8,
                  background: m.enabled ? '#f0f7ff' : '#f6f8fa',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={m.enabled}
                  onChange={() => toggle(m.key)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{ fontWeight: 600 }}>{m.label}</span>
                <span style={{ color: '#656d76', fontSize: 12 }}>{m.enabled ? '显示' : '隐藏'}</span>
              </label>
            ))}
          </div>
          <button className="btn" type="button" disabled={busy} onClick={() => void save()} style={{ marginTop: 14 }}>
            {busy ? '保存中...' : '保存设置'}
          </button>
          {message && <p style={{ marginTop: 12, ...messageStyle }}>{message}</p>}
        </section>
      )}
    </AdminPage>
  );
}