"use client";

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, getErrorMessage } from '../../lib/api';
import type { Problem, ListResponse } from '../../lib/types';
import { Spinner, DifficultyBadge, EmptyState } from '../../components/ui';
import AuthGate from '../../components/AuthGate';
import AdminPage from '../../components/AdminPage';

interface DailyToday {
  date: string | null;
  problem: { id: number; title: string; difficulty: string } | null;
  status: 'pending' | 'finished' | null;
  end_type: 'auto' | 'manual' | null;
  ended_at: string | null;
  result: {
    submissions: number;
    ac_submissions: number;
    ac_users: number;
    pass_rate: number;
    fastest: { username: string; runtime_ms: number } | null;
    leaderboard: Array<{ rank: number; username: string; first_ac_at: string }>;
  } | null;
}

export default function AdminDailyProblemPage() {
  return (
    <AuthGate staff>
      <AdminDailyInner />
    </AuthGate>
  );
}

function AdminDailyInner() {
  const [current, setCurrent] = useState<DailyToday | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cur, list] = await Promise.all([
        apiGet<DailyToday>('/api/admin/daily-problem'),
        apiGet<ListResponse<Problem>>('/api/problems?limit=100')
      ]);
      setCurrent(cur.data);
      setProblems(list.data.items);
      if (cur.data.problem != null) setSelected(String(cur.data.problem.id));
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

  async function onSave() {
    const problemId = Number(selected);
    if (!problemId) {
      setMessage('请选择题目');
      setMessageType('error');
      return;
    }
    setBusy(true);
    try {
      await apiPut<{ problem_id: number }>('/api/admin/daily-problem', { problem_id: problemId });
      setMessage('每日一题已更新');
      setMessageType('success');
      await load();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '保存失败'));
      setMessageType('error');
    } finally {
      setBusy(false);
    }
  }

  async function onEnd() {
    if (!window.confirm('提前结束今日每日一题并公布当日情况？')) return;
    setBusy(true);
    try {
      await apiPost<{ ended: boolean }>('/api/admin/daily-problem/end', {});
      setMessage('已提前结束并公布结果');
      setMessageType('success');
      await load();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '结束失败'));
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

  const finished = current?.status === 'finished';

  return (
    <AdminPage
      title="每日一题"
      subtitle={`每日 24:00（北京时间）自动截止并公布当日情况，也可手动提前结束`}
    >

      {loading ? (
        <Spinner label="加载中..." />
      ) : (
        <>
          <section className="card">
            <h3>当前每日一题（{current?.date ?? '-'}）</h3>
            {current?.problem ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span className="brand-mark" aria-hidden="true" style={{ width: 36, height: 36, fontSize: 16 }}>
                  {String(current.problem.id).padStart(2, '0')}
                </span>
                <div>
                  <div style={{ fontWeight: 600 }}>{current.problem.title}</div>
                  <div style={{ fontSize: 12, color: '#656d76' }}>
                    状态：{finished ? `已结束（${current.end_type === 'manual' ? '手动提前结束' : '24:00 自动截止'}）` : '进行中'}
                  </div>
                </div>
                <DifficultyBadge difficulty={current.problem.difficulty} />
                <div style={{ marginLeft: 'auto' }}>
                  {!finished ? (
                    <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void onEnd()}>
                      提前结束
                    </button>
                  ) : (
                    <span className="badge" style={{ background: '#dafbe1', color: '#1a7f37' }}>已公布</span>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState text="尚未设置每日一题" />
            )}

            {finished && current?.result && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #eaeef2', fontSize: 13 }}>
                <b>当日情况</b>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 8, color: '#57606a' }}>
                  <span>提交 <b>{current.result.submissions}</b></span>
                  <span>AC 提交 <b>{current.result.ac_submissions}</b></span>
                  <span>AC 人数 <b>{current.result.ac_users}</b></span>
                  <span>通过率 <b>{current.result.pass_rate}%</b></span>
                  {current.result.fastest && (
                    <span>最快 <b>{current.result.fastest.username}</b>（{current.result.fastest.runtime_ms} ms）</span>
                  )}
                </div>
                {current.result.leaderboard.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {current.result.leaderboard.map((r) => (
                      <span key={r.rank} className="badge" style={{ background: '#f6f8fa', color: r.rank <= 3 ? '#9a6700' : '#57606a' }}>
                        #{r.rank} {r.username}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="card">
            <h3>设置每日一题</h3>
            <p>
              <label>选择题目</label><br />
              <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ width: '100%' }}>
                <option value="">-- 请选择 --</option>
                {problems.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    #{String(p.id).padStart(2, '0')} {p.title} ({p.difficulty})
                  </option>
                ))}
              </select>
            </p>
            <button className="btn" type="button" disabled={busy} onClick={() => void onSave()}>
              {busy ? '保存中...' : '设为每日一题'}
            </button>
          </section>
        </>
      )}

      {message && <p style={{ marginTop: 12, ...messageStyle }}>{message}</p>}
    </AdminPage>
  );
}
