"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { apiGet, LANGUAGES, STATUSES } from '../lib/api';
import type { Submission, ListResponse } from '../lib/types';
import { StatusBadge } from '../components/ui';
import { LoadingCard, EmptyCard, ErrorText, Pagination } from '../components/data';
import { usePaginatedList } from '../hooks/useData';
import AuthGate from '../components/AuthGate';

const PAGE_SIZE = 10;

const LANG_LABELS: Record<string, string> = {
  python: 'Python',
  java: 'Java',
  javascript: 'JavaScript',
  node: 'Node.js',
  cpp: 'C++',
  c: 'C'
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { hour12: false });
}

export default function SubmissionsPage() {
  return (
    <AuthGate>
      <SubmissionsInner />
    </AuthGate>
  );
}

function SubmissionsInner() {
  const [status, setStatus] = useState('');
  const [language, setLanguage] = useState('');

  const fetcher = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (language) params.set('language', language);
    return (page: number, limit: number) =>
      apiGet<ListResponse<Submission>>(`/api/submissions?${params}&page=${page}&limit=${limit}`).then((r) => r.data);
  }, [status, language]);

  const { items, page, totalPages, loading, error, setPage } = usePaginatedList<Submission>(fetcher, PAGE_SIZE);

  return (
    <main className="container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>我的提交记录</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            aria-label="按状态筛选"
            style={{ width: 140 }}
          >
            <option value="">全部状态</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={language}
            onChange={(e) => { setLanguage(e.target.value); setPage(1); }}
            aria-label="按语言筛选"
            style={{ width: 130 }}
          >
            <option value="">全部语言</option>
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>{LANG_LABELS[lang] || lang}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <LoadingCard label="加载提交记录中..." />}
      {!loading && error && <ErrorText text={error} />}
      {!loading && !error && items.length === 0 && <EmptyCard text="暂无提交记录" />}
      {!loading && !error && items.length > 0 && (
        <div className="card fade-in" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 72 }}>#</th>
                  <th>题目</th>
                  <th style={{ width: 100 }}>状态</th>
                  <th style={{ width: 100 }}>语言</th>
                  <th style={{ width: 110, textAlign: 'right' }}>耗时</th>
                  <th style={{ width: 170 }}>时间</th>
                  <th style={{ width: 90, textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id}>
                    <td style={{ color: '#656d76', fontFamily: 'Consolas, monospace' }}>#{s.id}</td>
                    <td>
                      <Link href={`/problems/${s.problem_id}`} style={{ color: '#1f2328', fontWeight: 500 }}>
                        {s.problem_title}
                      </Link>
                    </td>
                    <td><StatusBadge status={s.status} /></td>
                    <td style={{ color: '#363a42' }}>{LANG_LABELS[s.language] || s.language}</td>
                    <td style={{ textAlign: 'right', color: '#363a42', fontFamily: 'Consolas, monospace' }}>
                      {s.runtime_ms != null ? `${s.runtime_ms} ms` : '-'}
                    </td>
                    <td style={{ color: '#656d76', fontSize: 13 }}>{formatTime(s.created_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="btn btn-secondary btn-sm" href={`/submissions/${s.id}`}>查看</Link>
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