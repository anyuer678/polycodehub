"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiGet, getErrorMessage } from '../../lib/api';
import type { Contest, ContestRow } from '../../lib/types';
import { Spinner, EmptyState, DifficultyBadge } from '../../components/ui';

export default function ContestDetailPage() {
  const params = useParams<{ id: string }>();
  const contestId = Number(params.id);

  const [contest, setContest] = useState<Contest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<Contest>(`/api/contests/${contestId}`)
      .then((r) => {
        if (!cancelled) setContest(r.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, '加载失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [contestId]);

  return (
    <main className="container">
      <div className="card fade-in" style={{ marginBottom: 16 }}>
        <Link href="/contests" style={{ fontSize: 13, color: '#0969da', textDecoration: 'none' }}>← 返回比赛列表</Link>
        {loading && <Spinner label="加载中..." />}
        {!loading && error && <p className="error">{error}</p>}
        {contest && (
          <>
            <h1 style={{ margin: '8px 0 4px' }}>{contest.name}</h1>
            <p style={{ color: '#656d76', fontSize: 13, marginTop: 0 }}>
              {new Date(contest.start_time).toLocaleString()} ~ {new Date(contest.end_time).toLocaleString()}
              {' · '}
              {contest.status === 'ongoing' ? '进行中' : contest.status === 'upcoming' ? '未开始' : '已结束'}
            </p>
            {contest.description && (
              <p style={{ whiteSpace: 'pre-wrap', color: '#363a42', lineHeight: 1.7 }}>{contest.description}</p>
            )}
          </>
        )}
      </div>

      {contest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }} className="contest-grid">
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 12 }}>题目列表</h2>
            {(contest.problems || []).length === 0 && <EmptyState text="暂无题目" />}
            {(contest.problems || []).map((p) => (
              <div key={p.id} style={{ padding: '8px 0', borderTop: '1px solid #d0d7de' }}>
                <Link href={`/problems/${p.id}`} style={{ color: '#1f2328', fontWeight: 500, textDecoration: 'none' }}>
                  {p.sort_order + 1}. {p.title}
                </Link>
                <span style={{ marginLeft: 8 }}><DifficultyBadge difficulty={p.difficulty} /></span>
              </div>
            ))}
          </section>

          <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-title" style={{ padding: '12px 16px', margin: 0, borderBottom: '1px solid #d0d7de' }}>
              实时榜单 <span style={{ fontWeight: 400, fontSize: 12, color: '#656d76' }}>（每 30 秒自动刷新）</span>
            </div>
            <ContestBoard contestId={contest.id} />
          </section>
        </div>
      )}
    </main>
  );
}

function ContestBoard({ contestId }: { contestId: number }) {
  const [rows, setRows] = useState<ContestRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<{ items: ContestRow[] }>(`/api/contests/${contestId}/leaderboard`)
      .then((r) => {
        if (!cancelled) setRows(r.data.items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [contestId]);

  useEffect(() => {
    const t = setInterval(() => {
      apiGet<{ items: ContestRow[] }>(`/api/contests/${contestId}/leaderboard`)
        .then((r) => setRows(r.data.items))
        .catch(() => undefined);
    }, 30000);
    return () => clearInterval(t);
  }, [contestId]);

  return (
    <div>
      {loading && <div style={{ padding: 16 }}><Spinner label="加载榜单中..." /></div>}
      {!loading && rows.length === 0 && <div style={{ padding: 16, color: '#656d76', fontSize: 13 }}>暂无参赛记录</div>}
      {!loading && rows.length > 0 && (
        <div className="table-wrap" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 56 }}>排名</th>
                <th>用户</th>
                <th style={{ width: 70 }}>AC</th>
                <th style={{ width: 90 }}>计时</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <td style={{ color: r.rank <= 3 ? '#0969da' : '#656d76', fontWeight: r.rank <= 3 ? 700 : 400 }}>
                    {r.rank}
                  </td>
                  <td>
                    <a href={`/users/${encodeURIComponent(r.username)}`} style={{ color: '#1f2328', fontWeight: 500 }}>
                      {r.username}
                    </a>
                  </td>
                  <td><span style={{ color: '#1a7f37', fontWeight: 600 }}>{r.ac_count}</span></td>
                  <td style={{ color: '#656d76', fontSize: 13 }}>{r.penalty_min} 分</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}