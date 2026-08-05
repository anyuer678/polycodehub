"use client";

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, getErrorMessage } from '../../lib/api';
import type { AdminSubmission, ListResponse } from '../../lib/types';
import { Spinner, StatusBadge } from '../../components/ui';
import AuthGate from '../../components/AuthGate';
import AdminPage from '../../components/AdminPage';

export default function AdminSubmissionsPage() {
  return (
    <AuthGate admin>
      <AdminSubmissionsInner />
    </AuthGate>
  );
}

function AdminSubmissionsInner() {
  const [items, setItems] = useState<AdminSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [username, setUsername] = useState('');
  const [usernameSearch, setUsernameSearch] = useState('');
  const [problem, setProblem] = useState('');
  const [problemSearch, setProblemSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(15) });
      if (status) params.set('status', status);
      if (usernameSearch) params.set('username', usernameSearch);
      if (problemSearch) params.set('problem', problemSearch);
      const payload = await apiGet<ListResponse<AdminSubmission>>(`/api/admin/submissions?${params}`);
      setItems(payload.data.items);
      setTotal(payload.data.total);
      setMessage('');
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '加载失败'));
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }, [page, status, usernameSearch, problemSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setUsernameSearch(username.trim());
    setProblemSearch(problem.trim());
  }

  async function rejudge(id: number) {
    if (!window.confirm(`确认重判提交 #${id} 吗？`)) return;
    setBusy(id);
    try {
      await apiPost<{ rejudged: boolean }>(`/api/admin/submissions/${id}/rejudge`, {});
      setMessage(`提交 #${id} 已重新入队判题`);
      setMessageType('success');
      setTimeout(() => void load(), 1500);
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '重判失败'));
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
      title="提交记录（管理员）"
      subtitle={`全站提交共 ${total} 条`}
    >

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          aria-label="按状态筛选"
          style={{ width: 120 }}
        >
          <option value="">全部状态</option>
          <option value="PENDING">PENDING</option>
          <option value="AC">AC</option>
          <option value="WA">WA</option>
          <option value="CE">CE</option>
          <option value="RE">RE</option>
          <option value="TLE">TLE</option>
        </select>
        <form onSubmit={onSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            type="search"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名..."
            style={{ width: 140 }}
            aria-label="按用户名筛选"
          />
          <input
            type="search"
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            placeholder="题目..."
            style={{ width: 140 }}
            aria-label="按题目筛选"
          />
          <button type="submit" className="btn btn-secondary">筛选</button>
        </form>
      </div>

      {loading && <Spinner label="加载提交记录中..." />}
      {!loading && items.length === 0 && <p>没有匹配的提交</p>}
      {!loading && items.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 56 }}>#</th>
                  <th>题目</th>
                  <th>用户</th>
                  <th>语言</th>
                  <th>状态</th>
                  <th>耗时</th>
                  <th>时间</th>
                  <th style={{ width: 80, textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id}>
                    <td style={{ color: '#656d76' }}>{s.id}</td>
                    <td>
                      <a href={`/submissions/${s.id}`} style={{ color: '#1f2328' }}>
                        {s.problem_title}
                      </a>
                    </td>
                    <td style={{ color: '#656d76' }}>{s.username}</td>
                    <td style={{ color: '#656d76' }}>{s.language}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td style={{ color: '#656d76' }}>{s.runtime_ms != null ? `${s.runtime_ms} ms` : '-'}</td>
                    <td style={{ color: '#656d76', fontSize: 13 }}>
                      {s.created_at ? new Date(s.created_at).toLocaleString() : '-'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy === s.id}
                        onClick={() => void rejudge(s.id)}
                      >
                        {busy === s.id ? '重判中...' : '重判'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
