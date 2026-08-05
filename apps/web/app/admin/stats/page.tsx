"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGet, getErrorMessage } from '../../lib/api';
import { StatusBadge } from '../../components/ui';
import { LoadingCard, ErrorText } from '../../components/data';
import AuthGate from '../../components/AuthGate';
import AdminPage from '../../components/AdminPage';

type AdminStats = {
  problems: number;
  users: number;
  submissions: number;
  statusDistribution: Array<{ status: string; count: string }>;
  recentSubmissions: Array<{
    id: number;
    status: string;
    language: string;
    username: string;
    problem_title: string;
    created_at: string;
  }>;
};

const STATUS_COLORS: Record<string, string> = {
  AC: '#1a7f37',
  WA: '#cf222e',
  CE: '#9a6700',
  RE: '#8250df',
  TLE: '#0969da',
  PENDING: '#656d76'
};

export default function AdminStatsPage() {
  return (
    <AuthGate admin>
      <AdminStatsInner />
    </AuthGate>
  );
}

function AdminStatsInner() {

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<AdminStats>('/api/admin/stats')
      .then((payload) => {
        if (!cancelled) setStats(payload.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, '加载失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const maxStatus = stats
    ? Math.max(1, ...stats.statusDistribution.map((s) => Number(s.count)))
    : 1;

  return (
    <AdminPage title="数据总览">

      {loading && <LoadingCard label="加载统计中..." />}
      {!loading && error && <ErrorText text={error} />}

      {!loading && !error && stats && (
        <>
          <div
            className="fade-in"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: 16
            }}
          >
            {[
              { label: '题目数', value: stats.problems, href: '/admin/problems' },
              { label: '用户数', value: stats.users },
              { label: '提交总数', value: stats.submissions, href: '/submissions' }
            ].map((item) => (
              <div key={item.label} className="card" style={{ margin: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 30, fontWeight: 700, color: '#0969da' }}>{item.value}</div>
                <div style={{ fontSize: 12, color: '#656d76', marginTop: 4 }}>
                  {item.href ? <Link href={item.href} style={{ color: '#656d76' }}>{item.label}</Link> : item.label}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }} className="stats-grid">
            <section className="card">
              <h2 className="card-title">判题结果分布</h2>
              {stats.statusDistribution.length === 0 && <p style={{ color: '#656d76' }}>暂无提交数据</p>}
              {stats.statusDistribution.map((s) => (
                <div key={s.status} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span style={{ color: '#363a42' }}>{s.status}</span>
                    <span style={{ color: '#656d76' }}>{s.count}</span>
                  </div>
                  <div style={{ background: '#f6f8fa', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${(Number(s.count) / maxStatus) * 100}%`,
                        background: STATUS_COLORS[s.status] || '#0969da',
                        height: '100%',
                        borderRadius: 4
                      }}
                    />
                  </div>
                </div>
              ))}
            </section>

            <section className="card">
              <h2 className="card-title">最近提交</h2>
              {stats.recentSubmissions.length === 0 && <p style={{ color: '#656d76' }}>暂无提交数据</p>}
              {stats.recentSubmissions.map((s) => (
                <div key={s.id} className="divider" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <StatusBadge status={s.status} />
                  <Link href={`/submissions/${s.id}`} style={{ color: '#363a42', fontSize: 13 }}>
                    {s.problem_title}
                  </Link>
                  <span style={{ marginLeft: 'auto', color: '#656d76', fontSize: 12 }}>
                    {s.username} · {s.language}
                  </span>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </AdminPage>
  );
}
