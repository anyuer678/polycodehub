"use client";

import { useMemo, useState } from 'react';
import { apiGet } from '../lib/api';
import type { LeaderboardRow } from '../lib/types';
import { LoadingCard, ErrorText, EmptyCard } from '../components/data';
import { usePaginatedList } from '../hooks/useData';

type Period = 'all' | 'weekly' | 'monthly';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: '总榜' },
  { value: 'weekly', label: '周榜' },
  { value: 'monthly', label: '月榜' }
];

const RANK_CLASS: Record<number, string> = {
  1: 'rank-medal rank-gold',
  2: 'rank-medal rank-silver',
  3: 'rank-medal rank-bronze'
};

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>('all');

  const fetcher = useMemo(
    () => (_page: number, _limit: number) =>
      apiGet<{ items: LeaderboardRow[] }>(`/api/leaderboard?period=${period}`).then((r) => ({
        items: r.data.items,
        total: r.data.items.length
      })),
    [period]
  );

  const { items, loading, error } = usePaginatedList<LeaderboardRow>(fetcher, 20);

  return (
    <main className="container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>排行榜（AC 数）</h1>
        <div className="segmented" role="tablist" aria-label="榜单周期">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              className={`btn btn-secondary btn-sm${period === p.value ? ' btn-active' : ''}`}
              onClick={() => setPeriod(p.value)}
              aria-pressed={period === p.value}
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <LoadingCard label="加载排行榜中..." />}
      {!loading && error && <ErrorText text={error} />}
      {!loading && !error && items.length === 0 && <EmptyCard text="暂无排行数据，快去通过第一道题吧" />}
      {!loading && !error && items.length > 0 && (
        <div className="card fade-in" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 64 }}>排名</th>
                  <th>用户</th>
                  <th style={{ width: 90 }}>AC</th>
                  <th style={{ width: 120 }}>提交次数</th>
                  <th>AC 率</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.user_id}>
                    <td>
                      <span className={RANK_CLASS[row.rank] || 'rank-plain'}>
                        {row.rank <= 3 ? `#${row.rank}` : `#${row.rank}`}
                      </span>
                    </td>
                    <td>
                      <div style={{ color: '#1f2328', fontWeight: 500 }}>
                        <a href={`/users/${encodeURIComponent(row.username)}`} style={{ color: 'inherit' }}>
                          {row.username}
                        </a>
                      </div>
                      <div style={{ color: '#656d76', fontSize: 12, fontFamily: 'Consolas, monospace' }}>
                        UID {row.user_id}
                      </div>
                    </td>
                    <td>
                      <span style={{ color: '#1a7f37', fontWeight: 600, fontFamily: 'Consolas, monospace' }}>
                        {row.ac_count}
                      </span>
                    </td>
                    <td style={{ color: '#363a42', fontFamily: 'Consolas, monospace' }}>
                      {row.submission_count}
                    </td>
                    <td>
                      <div className="progress">
                        <div className="progress-bar" style={{ width: `${row.pass_rate}%` }} />
                      </div>
                      <span style={{ color: '#656d76', fontSize: 12 }}>{row.pass_rate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}