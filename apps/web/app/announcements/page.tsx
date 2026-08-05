"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiGet, getErrorMessage } from '../lib/api';
import type { Announcement, ListResponse } from '../lib/types';
import { LoadingCard, ErrorText, EmptyCard, Pagination } from '../components/data';

const PAGE_SIZE = 10;

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'general', label: '常规' },
  { value: 'system', label: '系统' },
  { value: 'contest', label: '比赛' },
  { value: 'maintenance', label: '维护' },
  { value: 'feature', label: '功能' }
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label])
);

const READ_KEY = 'polycodehub_read_announcements';

function loadReadSet(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((n) => typeof n === 'number'));
  } catch {
    /* ignore */
  }
  return new Set();
}

function saveReadSet(set: Set<number>) {
  if (typeof window === 'undefined') return;
  try {
    // 只保留最近 200 条，避免无限增长
    const arr = Array.from(set).slice(-200);
    window.localStorage.setItem(READ_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

export default function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readSet, setReadSet] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // 首次挂载：加载已读集合
  useEffect(() => {
    setReadSet(loadReadSet());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (category) params.set('category', category);
      const payload = await apiGet<ListResponse<Announcement>>(`/api/announcements?${params}`);
      setItems(payload.data.items);
      setTotal(payload.data.total);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [page, category]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSelectCategory(c: string) {
    setCategory(c);
    setPage(1);
    setExpanded(new Set());
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // 展开后标记已读
    if (!readSet.has(id)) {
      const next = new Set(readSet);
      next.add(id);
      setReadSet(next);
      saveReadSet(next);
    }
  }

  function markAllRead() {
    const next = new Set(readSet);
    items.forEach((a) => next.add(a.id));
    setReadSet(next);
    saveReadSet(next);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const unreadCount = useMemo(
    () => items.filter((a) => !readSet.has(a.id)).length,
    [items, readSet]
  );

  return (
    <main className="container">
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <h1 className="page-title">公告历史</h1>
        <p className="admin-subtitle">
          共 {total} 条公告{unreadCount > 0 ? ` · ${unreadCount} 条未读` : ''}
          {unreadCount > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={markAllRead}
              style={{ marginLeft: 12, verticalAlign: 'middle' }}
            >
              全部标为已读
            </button>
          )}
        </p>

        <div
          style={{
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
            marginBottom: 16,
            padding: 6,
            background: '#f6f8fa',
            border: '1px solid #d0d7de',
            borderRadius: 8
          }}
        >
          <button
            type="button"
            className="btn btn-sm"
            style={!category
              ? { background: '#0969da', color: '#fff', borderColor: '#0969da' }
              : { background: 'transparent', borderColor: 'transparent', color: '#57606a' }}
            onClick={() => onSelectCategory('')}
          >
            全部
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              className="btn btn-sm"
              style={category === c.value
                ? { background: '#0969da', color: '#fff', borderColor: '#0969da' }
                : { background: 'transparent', borderColor: 'transparent', color: '#57606a' }}
              onClick={() => onSelectCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {loading && <LoadingCard label="加载公告中..." />}
        {!loading && error && <ErrorText text={error} />}
        {!loading && !error && items.length === 0 && <EmptyCard text="暂无公告" />}
        {!loading && !error && items.length > 0 && (
          <div>
            {items.map((a) => {
              const isRead = readSet.has(a.id);
              const isExpanded = expanded.has(a.id);
              return (
                <article
                  key={a.id}
                  className="card fade-in"
                  style={{ padding: '14px 16px', marginBottom: 12 }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleExpand(a.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExpand(a.id);
                      }
                    }}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                    aria-expanded={isExpanded}
                  >
                    {!isRead && (
                      <span
                        aria-label="未读"
                        title="未读"
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: '#0969da',
                          flexShrink: 0
                        }}
                      />
                    )}
                    <span style={{ fontWeight: isRead ? 500 : 700, color: '#1f2328' }}>
                      {a.title}
                    </span>
                    {a.pinned && (
                      <span className="badge" style={{ background: '#fff8c5', color: '#7d4e00', borderColor: '#d4a72c' }}>
                        置顶
                      </span>
                    )}
                    {a.category && (
                      <span className="badge" style={{ background: '#f6f8fa', color: '#57606a' }}>
                        {CATEGORY_LABEL[a.category] || a.category}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', color: '#656d76', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {a.creator_name && (
                        <>
                          <span>发布者：</span>
                          <Link
                            href={`/users/${a.creator_name}`}
                            style={{ color: '#0969da' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {a.creator_name}
                          </Link>
                          <span>·</span>
                        </>
                      )}
                      <span>{a.updated_at ? new Date(a.updated_at).toLocaleString() : '-'}</span>
                    </span>
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #d8dee4' }}>
                      <p style={{ color: '#363a42', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>
                        {a.content}
                      </p>
                      {a.expires_at && (
                        <p style={{ color: '#656d76', fontSize: 12, marginTop: 8 }}>
                          过期时间：{new Date(a.expires_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {!loading && !error && total > PAGE_SIZE && (
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        )}
      </div>
    </main>
  );
}
