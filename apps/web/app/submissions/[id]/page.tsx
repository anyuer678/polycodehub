"use client";

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiGet, apiPut, getErrorMessage } from '../../lib/api';
import type { SubmissionDetail } from '../../lib/types';
import { StatusBadge, Spinner } from '../../components/ui';
import AuthGate from '../../components/AuthGate';

export default function SubmissionDetailPage() {
  return (
    <AuthGate>
      <SubmissionDetailInner />
    </AuthGate>
  );
}

function SubmissionDetailInner() {
  const params = useParams<{ id: string }>();

  const [item, setItem] = useState<SubmissionDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMsg, setShareMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiGet<SubmissionDetail>(`/api/submissions/${params.id}`);
      setItem(payload.data);
      setError('');
    } catch (err: unknown) {
      setError(getErrorMessage(err, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleShare(enable: boolean) {
    setShareBusy(true);
    try {
      const payload = await apiPut<{ shared: boolean; share_token: string | null }>(
        `/api/submissions/${params.id}/share`,
        { enabled: enable }
      );
      setItem((prev) => (prev ? { ...prev, share_token: payload.data.share_token } : prev));
      setShareMsg(enable ? '分享链接已生成' : '分享链接已移除');
    } catch (err: unknown) {
      setShareMsg(getErrorMessage(err, '操作失败'));
    } finally {
      setShareBusy(false);
    }
  }

  async function copyShareLink() {
    if (!item?.share_token) return;
    const link = `${window.location.origin}/share/${item.share_token}`;
    try {
      await navigator.clipboard.writeText(link);
      setShareMsg('链接已复制到剪贴板');
    } catch {
      setShareMsg(`复制失败，请手动复制：${link}`);
    }
  }

  return (
    <main className="container">
      <h1>提交详情</h1>
      {loading && <Spinner label="加载中..." />}
      {!loading && error && <p className="error">{error}</p>}

      {item && (
        <section className="card fade-in">
          <p><b>ID:</b> {item.id}</p>
          <p><b>题目:</b> <a href={`/problems/${item.problem_id}`}>{item.problem_title || `#${item.problem_id}`}</a></p>
          <p><b>语言:</b> {item.language}</p>
          <p><b>状态:</b> <StatusBadge status={item.status} /></p>
          <p><b>耗时:</b> {item.runtime_ms ?? '-'} ms</p>
          <p><b>内存:</b> {item.memory_kb ?? '-'} kb</p>
          <p><b>错误:</b> {item.error_message || '-'}</p>
          <p><b>创建时间:</b> {item.created_at ? new Date(item.created_at).toLocaleString() : '-'}</p>

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

          <hr style={{ border: 'none', borderTop: '1px solid #d0d7de', margin: '18px 0' }} />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {item.share_token ? (
              <>
                <button className="btn btn-secondary" type="button" disabled={shareBusy} onClick={() => void toggleShare(false)}>
                  {shareBusy ? '处理中...' : '取消分享'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => void copyShareLink()}>
                  复制分享链接
                </button>
                <code style={{ fontSize: 12, color: '#57606a', wordBreak: 'break-all' }}>
                  {`${typeof window !== 'undefined' ? window.location.origin : ''}/share/${item.share_token}`}
                </code>
              </>
            ) : (
              <button className="btn btn-secondary" type="button" disabled={shareBusy} onClick={() => void toggleShare(true)}>
                {shareBusy ? '处理中...' : '生成分享链接'}
              </button>
            )}
            {shareMsg && <span style={{ fontSize: 13, color: '#57606a' }}>{shareMsg}</span>}
          </div>
        </section>
      )}
    </main>
  );
}
