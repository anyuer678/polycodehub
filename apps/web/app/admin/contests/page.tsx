"use client";

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, getErrorMessage } from '../../lib/api';
import type { Contest, Problem, ListResponse } from '../../lib/types';
import { Spinner, EmptyState, LoadingButton, DifficultyBadge } from '../../components/ui';
import AuthGate from '../../components/AuthGate';
import AdminPage from '../../components/AdminPage';

// ISO <-> datetime-local 互转
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(s: string): string {
  return new Date(s).toISOString();
}

function contestStatusBadge(status: string) {
  if (status === 'ongoing') return <span className="badge badge-ac" style={{ marginLeft: 8 }}>进行中</span>;
  if (status === 'upcoming') return <span className="badge badge-pending" style={{ marginLeft: 8 }}>未开始</span>;
  return <span className="badge" style={{ marginLeft: 8, background: '#f6f8fa', color: '#57606a' }}>已结束</span>;
}

export default function AdminContestsPage() {
  return (
    <AuthGate staff>
      <AdminContestsInner />
    </AuthGate>
  );
}

function AdminContestsInner() {
  const [items, setItems] = useState<Contest[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);

  // 创建表单
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [problemIds, setProblemIds] = useState<number[]>([]);

  // 编辑表单
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editProblemIds, setEditProblemIds] = useState<number[]>([]);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contestList, problemList] = await Promise.all([
        apiGet<{ items: Contest[] }>('/api/contests'),
        apiGet<ListResponse<Problem>>('/api/problems?limit=100')
      ]);
      setItems(contestList.data.items);
      setProblems(problemList.data.items);
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

  function toggleProblemId(id: number, list: number[], setter: (v: number[]) => void) {
    if (list.includes(id)) setter(list.filter((x) => x !== id));
    else setter([...list, id]);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!startTime || !endTime) {
      setMessage('请填写开始与结束时间');
      setMessageType('error');
      return;
    }
    if (problemIds.length === 0) {
      setMessage('请至少选择一道题目');
      setMessageType('error');
      return;
    }
    setBusy('create');
    try {
      await apiPost('/api/admin/contests', {
        name,
        description,
        start_time: localInputToIso(startTime),
        end_time: localInputToIso(endTime),
        problem_ids: problemIds
      });
      setMessage('比赛创建成功');
      setMessageType('success');
      setName('');
      setDescription('');
      setStartTime('');
      setEndTime('');
      setProblemIds([]);
      await load();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '创建失败'));
      setMessageType('error');
    } finally {
      setBusy(null);
    }
  }

  async function openEdit(c: Contest) {
    setEditId(c.id);
    setEditName(c.name);
    setEditDescription(c.description || '');
    setEditStartTime(isoToLocalInput(c.start_time));
    setEditEndTime(isoToLocalInput(c.end_time));
    setEditProblemIds([]);
    setBusy(`load-${c.id}`);
    try {
      const detail = await apiGet<Contest>(`/api/contests/${c.id}`);
      setEditProblemIds((detail.data.problems || []).map((p) => p.id));
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '加载比赛详情失败'));
      setMessageType('error');
    } finally {
      setBusy(null);
    }
  }

  async function onSaveEdit() {
    if (!editId) return;
    if (!editStartTime || !editEndTime) {
      setMessage('请填写开始与结束时间');
      setMessageType('error');
      return;
    }
    if (editProblemIds.length === 0) {
      setMessage('请至少选择一道题目');
      setMessageType('error');
      return;
    }
    setBusy('edit');
    try {
      await apiPut(`/api/admin/contests/${editId}`, {
        name: editName,
        description: editDescription,
        start_time: localInputToIso(editStartTime),
        end_time: localInputToIso(editEndTime),
        problem_ids: editProblemIds
      });
      setMessage(`比赛 #${editId} 已更新`);
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
    if (!window.confirm(`确认删除比赛 #${id} 吗？`)) return;
    setBusy(`del-${id}`);
    try {
      await apiDelete(`/api/admin/contests/${id}`);
      setMessage('比赛已删除');
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
    <AdminPage title="比赛管理（管理员）" subtitle={`共 ${items.length} 场比赛`}>
      <form className="card" onSubmit={onCreate}>
        <h3>创建比赛</h3>
        <p>
          <label>名称</label><br />
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={255} style={{ width: '100%' }} />
        </p>
        <p>
          <label>描述（可选）</label><br />
          <textarea className="textarea-full" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={10000} />
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 8 }}>
          <p>
            <label>开始时间</label><br />
            <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ width: '100%' }} />
          </p>
          <p>
            <label>结束时间</label><br />
            <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ width: '100%' }} />
          </p>
        </div>
        <p>
          <label>题目（至少选 1 道）</label><br />
          {problems.length === 0 ? (
            <span style={{ color: '#656d76', fontSize: 13 }}>加载题目中...</span>
          ) : (
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #d0d7de', borderRadius: 6, padding: 8, background: '#f6f8fa' }}>
              {problems.map((p) => (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={problemIds.includes(p.id)}
                    onChange={() => toggleProblemId(p.id, problemIds, setProblemIds)}
                  />
                  <span style={{ fontSize: 13 }}>
                    <b>#{p.id}</b> {p.title}
                  </span>
                  <DifficultyBadge difficulty={p.difficulty} />
                </label>
              ))}
            </div>
          )}
        </p>
        <LoadingButton loading={busy === 'create'} type="submit">创建比赛</LoadingButton>
      </form>

      <section className="card">
        <h3>比赛列表</h3>
        {loading ? (
          <Spinner label="加载比赛中..." />
        ) : items.length === 0 ? (
          <EmptyState text="暂无比赛" />
        ) : (
          items.map((c) => (
            <div key={c.id} className="fade-in divider">
              <p style={{ margin: '4px 0' }}>
                <b>#{c.id}</b> {c.name}
                {contestStatusBadge(c.status)}
                <span style={{ marginLeft: 8, color: '#656d76', fontSize: 12 }}>
                  {c.problem_count ?? 0} 道题
                </span>
                <span style={{ marginLeft: 8, color: '#656d76', fontSize: 12 }}>
                  创建者：{c.creator_name || '未知'}
                </span>
              </p>
              {c.description && (
                <p style={{ color: '#363a42', fontSize: 13, whiteSpace: 'pre-wrap', margin: '4px 0 8px' }}>{c.description}</p>
              )}
              <p style={{ color: '#656d76', fontSize: 12, margin: '4px 0 8px' }}>
                {new Date(c.start_time).toLocaleString()} ~ {new Date(c.end_time).toLocaleString()}
              </p>
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => void openEdit(c)}
                style={{ marginRight: 8 }}
                disabled={busy === `load-${c.id}`}
              >
                {busy === `load-${c.id}` ? '加载中...' : '编辑'}
              </button>
              <button
                className="btn btn-danger btn-sm"
                type="button"
                disabled={busy === `del-${c.id}`}
                onClick={() => void onDelete(c.id)}
              >
                删除
              </button>
            </div>
          ))
        )}
      </section>

      {editId && (
        <section className="card fade-in">
          <h3>编辑比赛 #{editId}</h3>
          <p>
            <label>名称</label><br />
            <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: '100%' }} />
          </p>
          <p>
            <label>描述</label><br />
            <textarea className="textarea-full" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} />
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 8 }}>
            <p>
              <label>开始时间</label><br />
              <input type="datetime-local" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} style={{ width: '100%' }} />
            </p>
            <p>
              <label>结束时间</label><br />
              <input type="datetime-local" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} style={{ width: '100%' }} />
            </p>
          </div>
          <p>
            <label>题目（至少选 1 道）</label><br />
            {problems.length === 0 ? (
              <span style={{ color: '#656d76', fontSize: 13 }}>加载题目中...</span>
            ) : (
              <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #d0d7de', borderRadius: 6, padding: 8, background: '#f6f8fa' }}>
                {problems.map((p) => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editProblemIds.includes(p.id)}
                      onChange={() => toggleProblemId(p.id, editProblemIds, setEditProblemIds)}
                    />
                    <span style={{ fontSize: 13 }}>
                      <b>#{p.id}</b> {p.title}
                    </span>
                    <DifficultyBadge difficulty={p.difficulty} />
                  </label>
                ))}
              </div>
            )}
          </p>
          <LoadingButton loading={busy === 'edit'} type="button" style={{ marginRight: 8 }} onClick={() => void onSaveEdit()}>
            保存
          </LoadingButton>
          <button className="btn" type="button" onClick={() => setEditId(null)}>取消</button>
        </section>
      )}

      {message && <p style={{ marginTop: 12, ...messageStyle }}>{message}</p>}
    </AdminPage>
  );
}
