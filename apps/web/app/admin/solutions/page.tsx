"use client";

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut, getErrorMessage } from '../../lib/api';
import type { Solution, ListResponse } from '../../lib/types';
import { Spinner, EmptyState } from '../../components/ui';
import AuthGate from '../../components/AuthGate';
import AdminPage from '../../components/AdminPage';

const PAGE_SIZE = 10;

type StatusFilter = 'pending' | 'approved' | 'rejected' | '';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
  { value: '', label: '全部' }
];

function statusBadge(status: string) {
  if (status === 'approved') return <span className="badge badge-ac" style={{ marginLeft: 8 }}>已通过</span>;
  if (status === 'rejected') return <span className="badge badge-wa" style={{ marginLeft: 8 }}>已拒绝</span>;
  return <span className="badge badge-pending" style={{ marginLeft: 8 }}>待审核</span>;
}

export default function AdminSolutionsPage() {
  return (
    <AuthGate staff>
      <AdminSolutionsInner />
    </AuthGate>
  );
}

function AdminSolutionsInner() {
  const [items, setItems] = useState<Solution[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (statusFilter) params.set('status', statusFilter);
      const payload = await apiGet<ListResponse<Solution>>(`/api/admin/solutions?${params}`);
      setItems(payload.data.items);
      setTotal(payload.data.total);
      setMessage('');
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '加载失败'));
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function changeFilter(f: StatusFilter) {
    setStatusFilter(f);
    setPage(1);
    setExpandedId(null);
  }

  async function onReview(id: number, status: 'approved' | 'rejected') {
    setBusy(`${status}-${id}`);
    try {
      await apiPut<Solution>(`/api/admin/solutions/${id}`, { status });
      setMessage(`题解 #${id} 已${status === 'approved' ? '通过' : '拒绝'}`);
      setMessageType('success');
      await load();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '审核失败'));
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminPage title="题解审核（管理员）" subtitle={`共 ${total} 条题解`}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.value;
          return (
            <button
              key={f.value || 'all'}
              type="button"
              className="btn btn-sm"
              style={
                active
                  ? { background: '#0969da', color: '#fff', borderColor: '#0969da' }
                  : { background: '#f6f8fa', borderColor: '#d0d7de', color: '#57606a' }
              }
              onClick={() => changeFilter(f.value)}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 24 }}><Spinner label="加载题解中..." /></div>
        ) : items.length === 0 ? (
          <EmptyState text="暂无题解" />
        ) : (
          items.map((s) => (
            <div key={s.id} className="fade-in" style={{ padding: '12px 16px', borderBottom: '1px solid #d0d7de' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14 }}>
                  <b>#{s.id}</b> {s.title}
                  {statusBadge(s.status)}
                  <div style={{ marginTop: 4, color: '#656d76', fontSize: 12 }}>
                    <span>题目：{s.problem_title || `#${s.problem_id}`}</span>
                    <span style={{ marginLeft: 12 }}>作者：{s.username || `用户#${s.user_id}`}</span>
                  </div>
                </div>
                <span style={{ color: '#656d76', fontSize: 12 }}>
                  {new Date(s.created_at).toLocaleString()}
                </span>
              </div>

              {expandedId === s.id && (
                <div style={{ marginTop: 10, padding: 12, background: '#f6f8fa', border: '1px solid #d0d7de', borderRadius: 6 }}>
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 13, fontFamily: 'inherit', color: '#1f2328' }}>
                    {s.content}
                  </pre>
                </div>
              )}

              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                >
                  {expandedId === s.id ? '收起内容' : '查看内容'}
                </button>
                {s.status !== 'approved' && (
                  <button
                    className="btn btn-sm"
                    type="button"
                    style={{ background: '#1a7f37', color: '#fff', borderColor: '#1a7f37' }}
                    disabled={busy === `approved-${s.id}`}
                    onClick={() => void onReview(s.id, 'approved')}
                  >
                    {busy === `approved-${s.id}` ? '处理中...' : '通过'}
                  </button>
                )}
                {s.status !== 'rejected' && (
                  <button
                    className="btn btn-danger btn-sm"
                    type="button"
                    disabled={busy === `rejected-${s.id}`}
                    onClick={() => void onReview(s.id, 'rejected')}
                  >
                    {busy === `rejected-${s.id}` ? '处理中...' : '拒绝'}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span style={{ alignSelf: 'center', fontSize: 13, color: '#656d76' }}>
            第 {page} / {totalPages} 页
          </span>
          <button className="btn btn-secondary btn-sm" type="button" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>
            下一页
          </button>
        </div>
      )}

      {message && <p style={{ marginTop: 12, ...messageStyle }}>{message}</p>}
    </AdminPage>
  );
}
