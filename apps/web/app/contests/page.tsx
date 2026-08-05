"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiGet, getErrorMessage } from '../lib/api';
import type { Contest } from '../lib/types';
import { Spinner, EmptyState } from '../components/ui';

type Filter = 'all' | 'ongoing' | 'upcoming' | 'finished';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'ongoing', label: '进行中' },
  { value: 'upcoming', label: '未开始' },
  { value: 'finished', label: '已结束' }
];

function statusBadge(status: string) {
  if (status === 'ongoing') return <span className="badge badge-ac">进行中</span>;
  if (status === 'upcoming') return <span className="badge badge-pending">未开始</span>;
  return <span className="badge" style={{ background: '#f6f8fa', color: '#57606a' }}>已结束</span>;
}

export default function ContestsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<Contest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<{ items: Contest[] }>('/api/contests')
      .then((r) => {
        if (!cancelled) setItems(r.data.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, '加载失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((c) => c.status === filter)),
    [items, filter]
  );

  const now = Date.now();

  return (
    <main className="container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>比赛</h1>
        <div className="segmented" role="tablist" aria-label="比赛状态">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`btn btn-secondary btn-sm${filter === f.value ? ' btn-active' : ''}`}
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <Spinner label="加载比赛中..." />}
      {!loading && error && <p className="error">{error}</p>}
      {!loading && !error && filtered.length === 0 && <EmptyState text="暂无比赛" />}

      {!loading && !error && filtered.map((c) => (
        <div key={c.id} className="card fade-in" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Link href={`/contests/${c.id}`} style={{ fontSize: 17, fontWeight: 700, color: '#0969da', textDecoration: 'none' }}>
              {c.name}
            </Link>
            {statusBadge(c.status)}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#656d76' }}>
              {c.problem_count ?? 0} 道题
            </span>
          </div>
          {c.description && (
            <p style={{ color: '#363a42', fontSize: 13, whiteSpace: 'pre-wrap', margin: '8px 0' }}>
              {c.description}
            </p>
          )}
          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#656d76' }}>
            时间：{new Date(c.start_time).toLocaleString()} ~ {new Date(c.end_time).toLocaleString()}
            {c.status === 'upcoming' && (
              <span style={{ marginLeft: 10 }}>
                距开始 {Math.ceil((new Date(c.start_time).getTime() - now) / 60000)} 分钟
              </span>
            )}
          </p>
        </div>
      ))}
    </main>
  );
}