"use client";

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiGet } from '../lib/api';
import type { Problem, SolvedItem, ListResponse } from '../lib/types';
import { DifficultyBadge } from '../components/ui';
import { LoadingCard, EmptyCard, ErrorText, Pagination } from '../components/data';
import { usePaginatedList } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';

const PAGE_SIZE = 10;

const DIFFICULTIES = [
  { value: '', label: '全部难度' },
  { value: 'EASY', label: 'EASY' },
  { value: 'MEDIUM', label: 'MEDIUM' },
  { value: 'HARD', label: 'HARD' }
];

const TAGS = ['数组', '字符串', '哈希表', '双指针', '动态规划', '数学', '栈', '队列', '滑动窗口', '二分查找', '位运算', '深度优先搜索', '图', '拓扑排序', '矩阵', '贪心'];

const TAG_COLORS: Record<string, string> = {
  '数组': '#ddf4ff', '字符串': '#ffebda', '哈希表': '#dafbe1', '双指针': '#fff1e5',
  '动态规划': '#fbefff', '数学': '#eaeef2', '栈': '#ffeef1', '队列': '#e6ffec',
  '滑动窗口': '#d1f0ff', '二分查找': '#f0fff4', '位运算': '#fff8c5', '深度优先搜索': '#e6e6ff',
  '图': '#ffe2e9', '拓扑排序': '#f6f8fa', '矩阵': '#ddf4ff', '贪心': '#ffeed9'
};

function TagChip({ tag }: { tag: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 8px', borderRadius: 12, fontSize: 12,
      background: TAG_COLORS[tag] || '#f6f8fa', color: '#0969da', marginRight: 4, marginTop: 4
    }}>
      {tag}
    </span>
  );
}

export default function ProblemsPage() {
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [tag, setTag] = useState('');
  const { isLoggedIn } = useAuth();
  const [solved, setSolved] = useState<Set<number>>(new Set());
  const [randomPick, setRandomPick] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoggedIn) {
      setSolved(new Set());
      return;
    }
    let cancelled = false;
    apiGet<{ items: SolvedItem[] }>('/api/users/me/solved')
      .then((r) => {
        if (!cancelled) setSolved(new Set(r.data.items.map((i) => i.id)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (randomPick == null) return;
    window.location.href = `/problems/${randomPick}`;
  }, [randomPick]);

  async function onRandom() {
    const params = new URLSearchParams({ page: '1', limit: '100' });
    if (search) params.set('search', search);
    if (difficulty) params.set('difficulty', difficulty);
    if (tag) params.set('tag', tag);
    try {
      const r = await apiGet<ListResponse<Problem>>(`/api/problems?${params}`);
      let pool = r.data.items;
      if (isLoggedIn && pool.length > 1) {
        const unsolved = pool.filter((p) => !solved.has(p.id));
        if (unsolved.length > 0) pool = unsolved;
      }
      if (pool.length === 0) return;
      setRandomPick(pool[Math.floor(Math.random() * pool.length)].id);
    } catch {
      // ignore
    }
  }

  const fetcher = useMemo(
    () => (p: number, size: number) => {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('limit', String(size));
      if (search) params.set('search', search);
      if (difficulty) params.set('difficulty', difficulty);
      if (tag) params.set('tag', tag);
      return apiGet<ListResponse<Problem>>(`/api/problems?${params}`).then((r) => r.data);
    },
    [search, difficulty, tag]
  );

  const { items, page, totalPages, loading, error, setPage } = usePaginatedList<Problem>(fetcher, PAGE_SIZE);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setSearch(keyword.trim());
    setPage(1);
  }

  return (
    <main className="container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>题库</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-secondary" onClick={() => void onRandom()} aria-label="随机一题">
            随机一题{isLoggedIn ? '（未解）' : ''}
          </button>
          <form onSubmit={onSearch} style={{ display: 'flex', gap: 8 }}>
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索题目标题..."
              style={{ width: 220 }}
              aria-label="搜索题目"
            />
            <button type="submit" className="btn btn-secondary">搜索</button>
          </form>
          <select
            value={difficulty}
            onChange={(e) => { setDifficulty(e.target.value); setPage(1); }}
            aria-label="按难度筛选"
            style={{ width: 130 }}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          <select
            value={tag}
            onChange={(e) => { setTag(e.target.value); setPage(1); }}
            aria-label="按标签筛选"
            style={{ width: 140 }}
          >
            <option value="">全部标签</option>
            {TAGS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <LoadingCard label="加载题目中..." />}
      {!loading && error && <ErrorText text={error} />}
      {!loading && !error && items.length === 0 && (
        <EmptyCard text={search ? `未找到与 "${search}" 相关的题目` : '暂无题目'} />
      )}
      {!loading && !error && items.length > 0 && (
        <div className="card fade-in" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 64 }}>#</th>
                  <th>题目</th>
                  <th style={{ width: 90 }}>通过率</th>
                  <th style={{ width: 110 }}>难度</th>
                  <th style={{ width: 80, textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td style={{ color: '#656d76', fontFamily: 'Consolas, monospace' }}>
                      {String(p.id).padStart(2, '0')}
                    </td>
                    <td>
                      <Link href={`/problems/${p.id}`} style={{ color: '#1f2328', fontWeight: 500 }}>
                        {solved.has(p.id) && <span className="badge badge-ac" style={{ marginRight: 6 }} title="已通过">✓</span>}
                        {p.title}
                      </Link>
                      <div>
                        {(p.tags || []).map((t) => <TagChip key={t} tag={t} />)}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', color: p.ac_rate >= 60 ? '#1a7f37' : p.ac_rate >= 30 ? '#9a6700' : '#cf222e', fontSize: 13 }}>
                      {p.submission_count > 0 ? `${p.ac_rate}% (${p.ac_count}/${p.submission_count})` : '暂无提交'}
                    </td>
                    <td>
                      <DifficultyBadge difficulty={p.difficulty} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="btn btn-secondary btn-sm" href={`/problems/${p.id}`}>
                        进入
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </main>
  );
}