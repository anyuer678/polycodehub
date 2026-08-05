"use client";

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost, getErrorMessage } from '../lib/api';
import type { Solution, SolvedItem, SolutionComment } from '../lib/types';
import { EmptyState, LoadingButton, Spinner } from './ui';

interface SolutionsPanelProps {
  problemId: number;
  isLoggedIn: boolean;
}

export default function SolutionsPanel({ problemId, isLoggedIn }: SolutionsPanelProps) {
  const router = useRouter();
  const [items, setItems] = useState<Solution[]>([]);
  const [loading, setLoading] = useState(true);
  const [solved, setSolved] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, SolutionComment[]>>({});
  const [commentText, setCommentText] = useState('');
  const [commentTarget, setCommentTarget] = useState<number | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);

  const loadComments = useCallback(async (solutionId: number, cancelledRef: { cancelled: boolean }) => {
    try {
      const payload = await apiGet<{ items: SolutionComment[] }>(`/api/solutions/${solutionId}/comments`);
      if (!cancelledRef.cancelled) setComments((prev) => ({ ...prev, [solutionId]: payload.data.items }));
    } catch {
      if (!cancelledRef.cancelled) setComments((prev) => ({ ...prev, [solutionId]: [] }));
    }
  }, []);

  useEffect(() => {
    if (expandedId === null) return;
    const cancelledRef = { cancelled: false };
    void loadComments(expandedId, cancelledRef);
    return () => { cancelledRef.cancelled = true; };
  }, [expandedId, loadComments]);

  const load = useCallback(async (cancelledRef: { cancelled: boolean }) => {
    setLoading(true);
    try {
      const payload = await apiGet<{ items: Solution[] }>(`/api/problems/${problemId}/solutions`);
      if (!cancelledRef.cancelled) setItems(payload.data.items);
    } catch {
      if (!cancelledRef.cancelled) setItems([]);
    } finally {
      if (!cancelledRef.cancelled) setLoading(false);
    }
  }, [problemId]);

  useEffect(() => {
    const cancelledRef = { cancelled: false };
    void load(cancelledRef);
    return () => { cancelledRef.cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const cancelledRef = { cancelled: false };
    apiGet<{ items: SolvedItem[] }>('/api/users/me/solved')
      .then((r) => {
        if (!cancelledRef.cancelled) setSolved(r.data.items.some((s) => s.id === problemId));
      })
      .catch(() => undefined);
    return () => { cancelledRef.cancelled = true; };
  }, [isLoggedIn, problemId]);

  async function onPublish(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setMessage('请输入题解标题');
      setMessageType('error');
      return;
    }
    if (!content.trim()) {
      setMessage('请输入题解内容');
      setMessageType('error');
      return;
    }
    setBusy(true);
    try {
      await apiPost<Solution>('/api/solutions', {
        problem_id: problemId,
        title: title.trim(),
        content: content.trim()
      });
      setMessage('题解已提交，等待管理员审核通过后展示');
      setMessageType('success');
      setTitle('');
      setContent('');
      setShowForm(false);
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '发布失败'));
      setMessageType('error');
    } finally {
      setBusy(false);
    }
  }

  async function postComment() {
    if (commentTarget === null || !commentText.trim()) return;
    setCommentBusy(true);
    try {
      const payload = await apiPost<SolutionComment>(`/api/solutions/${commentTarget}/comments`, { content: commentText.trim() });
      setComments((prev) => ({
        ...prev,
        [commentTarget]: [...(prev[commentTarget] || []), payload.data]
      }));
      setCommentText('');
      setCommentTarget(null);
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '评论失败'));
      setMessageType('error');
    } finally {
      setCommentBusy(false);
    }
  }

  const messageStyle =
    messageType === 'error'
      ? { color: '#cf222e' }
      : messageType === 'success'
        ? { color: '#1a7f37' }
        : { color: '#656d76' };

  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 className="card-title" style={{ marginBottom: 0 }}>题解（{items.length}）</h2>
        {isLoggedIn && solved && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? '收起' : '写题解'}
          </button>
        )}
      </div>

      {!isLoggedIn && (
        <p style={{ fontSize: 13, color: '#656d76' }}>
          登录并 AC 本题后可发布题解。
          <a
            href="/login"
            style={{ marginLeft: 6, color: '#0969da' }}
            onClick={(e) => {
              e.preventDefault();
              router.push('/login');
            }}
          >
            去登录
          </a>
        </p>
      )}
      {isLoggedIn && !solved && (
        <p style={{ fontSize: 13, color: '#656d76' }}>通过本题后可发布题解。</p>
      )}

      {showForm && (
        <form onSubmit={onPublish} className="fade-in" style={{ marginTop: 12 }}>
          <div className="input-group">
            <label className="field-label" htmlFor="sol-title">标题</label>
            <input
              id="sol-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：双指针解法"
              maxLength={255}
            />
          </div>
          <div className="input-group">
            <label className="field-label" htmlFor="sol-content">内容（支持 Markdown 语法展示）</label>
            <textarea
              id="sol-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              maxLength={20000}
              placeholder={'思路：\n1. ...\n\n代码：\n```python\nprint("hello")\n```'}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'Consolas, monospace', fontSize: 13 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <LoadingButton loading={busy} type="submit">提交题解</LoadingButton>
            {message && <span style={{ fontSize: 13, ...messageStyle }}>{message}</span>}
          </div>
        </form>
      )}

      <div style={{ marginTop: 12 }}>
        {loading && <Spinner label="加载题解中..." />}
        {!loading && items.length === 0 && <EmptyState text="暂无题解，期待你的分享" />}
        {items.map((s) => (
          <div key={s.id} style={{ padding: '10px 0', borderTop: '1px solid #d0d7de' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 14 }}>{s.title}</b>
              <span style={{ fontSize: 12, color: '#656d76' }}>
                <a href={`/users/${encodeURIComponent(s.username || '')}`} style={{ color: '#0969da' }}>
                  {s.username}
                </a>
                {' · '}
                {new Date(s.created_at).toLocaleDateString()}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
              >
                {expandedId === s.id ? '收起' : '展开'}
              </button>
            </div>
            {expandedId === s.id && (
              <>
                <pre
                  className="fade-in"
                  style={{
                    margin: '10px 0 0',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    lineHeight: 1.7,
                    background: '#f6f8fa',
                    border: '1px solid #d0d7de',
                    borderRadius: 6,
                    padding: 12,
                    color: '#1f2328'
                  }}
                >
                  {s.content}
                </pre>
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#f6f8fa', border: '1px solid #eaeef2', borderRadius: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    评论（{(comments[s.id] || []).length}）
                  </div>
                  {isLoggedIn && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <input
                        value={commentTarget === s.id ? commentText : ''}
                        onChange={(e) => {
                          setCommentTarget(s.id);
                          setCommentText(e.target.value);
                        }}
                        onFocus={() => setCommentTarget(s.id)}
                        placeholder="写下你的评论..."
                        maxLength={2000}
                        style={{ flex: 1 }}
                        aria-label={`对题解 ${s.title} 评论`}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={commentBusy || commentTarget !== s.id || !commentText.trim()}
                        onClick={() => void postComment()}
                      >
                        评论
                      </button>
                    </div>
                  )}
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(comments[s.id] || []).length === 0 && (
                      <span style={{ fontSize: 13, color: '#656d76' }}>暂无评论</span>
                    )}
                    {(comments[s.id] || []).map((c) => (
                      <div key={c.id} style={{ fontSize: 13, lineHeight: 1.5 }}>
                        <a href={`/users/${encodeURIComponent(c.username)}`} style={{ color: '#0969da', fontWeight: 600 }}>
                          {c.username}
                        </a>
                        <span style={{ color: '#656d76', fontSize: 12, marginLeft: 6 }}>
                          {new Date(c.created_at).toLocaleString()}
                        </span>
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.content}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
