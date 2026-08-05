"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiGet, getErrorMessage } from '../../lib/api';
import type { SharedSubmission } from '../../lib/types';
import { Spinner, StatusBadge } from '../../components/ui';

export default function SharePage() {
  const params = useParams<{ token: string }>();

  const [item, setItem] = useState<SharedSubmission | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<SharedSubmission>(`/api/submissions/share/${params.token}`)
      .then((payload) => {
        if (cancelled) return;
        setItem(payload.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, '分享链接无效或已失效'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [params.token]);

  return (
    <main className="container">
      <h1>分享的提交</h1>
      {loading && <Spinner label="加载中..." />}
      {!loading && error && <p className="error">{error}</p>}

      {item && (
        <section className="card fade-in">
          <p style={{ marginTop: 0 }}>
            <b>作者:</b>{' '}
            <a href={`/users/${encodeURIComponent(item.username)}`} style={{ color: '#0969da' }}>
              {item.username}
            </a>
          </p>
          <p><b>题目:</b> <a href={`/problems/${item.problem_id}`} style={{ color: '#0969da' }}>{item.problem_title}</a></p>
          <p><b>语言:</b> {item.language}</p>
          <p><b>状态:</b> <StatusBadge status={item.status} /></p>
          <p><b>耗时:</b> {item.runtime_ms ?? '-'} ms / <b>内存:</b> {item.memory_kb ?? '-'} kb</p>
          <p><b>提交时间:</b> {item.created_at ? new Date(item.created_at).toLocaleString() : '-'}</p>

          {item.error_message && (
            <p><b>错误信息:</b> {item.error_message}</p>
          )}

          {item.failed_case_input && (
            <>
              <p><b>失败用例输入:</b></p>
              <pre>{item.failed_case_input}</pre>
              <p><b>期望输出:</b></p>
              <pre>{item.expected_output || '-'}</pre>
              <p><b>实际输出:</b></p>
              <pre>{item.actual_output || '-'}</pre>
            </>
          )}

          <p><b>源代码:</b></p>
          <pre style={{ maxHeight: 480, overflow: 'auto' }}>{item.source_code}</pre>
        </section>
      )}
    </main>
  );
}
