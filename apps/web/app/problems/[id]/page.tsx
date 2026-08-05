"use client";

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiGet, apiPost, apiPut, apiDelete, LANGUAGES, getErrorMessage } from '../../lib/api';
import type { FavoriteItem, Problem, TestCase } from '../../lib/types';
import { DifficultyBadge, EmptyState, StatusBadge, LoadingButton } from '../../components/ui';
import CodeEditor from '../../components/CodeEditor';
import RunPanel from '../../components/RunPanel';
import SolutionsPanel from '../../components/SolutionsPanel';
import { usePollSubmission } from '../../hooks/usePollSubmission';
import { useAuth } from '../../hooks/useAuth';

const LANGUAGE_TEMPLATES: Record<string, string> = {
  python: 'import sys\n\nlines = [l.strip() for l in sys.stdin if l.strip()]\n# 在此实现你的解法\n# 从 stdin 读取输入，将答案 print 到 stdout\nprint("")',
  javascript: 'const readline = require("readline");\nconst rl = readline.createInterface({ input: process.stdin });\nconst lines = [];\nrl.on("line", (l) => lines.push(l));\nrl.on("close", () => {\n  // 在此实现你的解法\n  // lines 为按行读取的输入\n  console.log("");\n});',
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // 在此实现你的解法\n        System.out.println("");\n    }\n}',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // 在此实现你的解法\n    cout << "" << endl;\n    return 0;\n}',
  c: '#include <stdio.h>\n\nint main() {\n    // 在此实现你的解法\n    printf("\\n");\n    return 0;\n}',
  go: 'package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tscanner := bufio.NewScanner(os.Stdin)\n\tfor scanner.Scan() {\n\t\t_ = scanner.Text()\n\t}\n\t// 在此实现你的解法\n\tfmt.Println("")\n}',
  rust: 'use std::io::{self, BufRead};\n\nfn main() {\n    let stdin = io::stdin();\n    let lines: Vec<String> = stdin.lock().lines().map(|l| l.unwrap()).collect();\n    // 在此实现你的解法\n    println!("");\n}'
};

export default function ProblemDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const problemId = useMemo(() => Number(params.id), [params.id]);
  const { isLoggedIn } = useAuth();

  const [problem, setProblem] = useState<Problem | null>(null);
  const [samples, setSamples] = useState<TestCase[]>([]);
  const [language, setLanguage] = useState('python');
  const [sourceCode, setSourceCode] = useState(LANGUAGE_TEMPLATES.python);
  const [message, setMessage] = useState('加载中...');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');
  const [submitting, setSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState<number | null>(null);
  const [favorited, setFavorited] = useState(false);
  const [favPending, setFavPending] = useState(false);

  const { item: submitResult, done, error: pollError } = usePollSubmission(submissionId);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiGet<Problem>(`/api/problems/${problemId}`),
      apiGet<{ items: TestCase[] }>(`/api/problems/${problemId}/test-cases`)
    ])
      .then(([problemPayload, samplePayload]) => {
        if (cancelled) return;
        setProblem(problemPayload.data);
        setSamples(samplePayload.data.items);
        setMessage('');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMessage(getErrorMessage(err, '加载失败'));
        setMessageType('error');
      });
    return () => { cancelled = true; };
  }, [problemId]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    apiGet<{ items: FavoriteItem[] }>('/api/users/me/favorites')
      .then((r) => {
        if (!cancelled) setFavorited(r.data.items.some((f) => f.id === problemId));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [isLoggedIn, problemId]);

  async function toggleFavorite() {
    if (!isLoggedIn) {
      setMessage('请先登录');
      setMessageType('error');
      router.push('/login');
      return;
    }
    setFavPending(true);
    try {
      if (favorited) {
        await apiDelete(`/api/users/me/favorites/${problemId}`);
        setFavorited(false);
      } else {
        await apiPut(`/api/users/me/favorites/${problemId}`, {});
        setFavorited(true);
      }
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '操作失败'));
      setMessageType('error');
    } finally {
      setFavPending(false);
    }
  }

  useEffect(() => {
    if (submissionId === null) return;
    if (pollError) {
      setMessage(pollError);
      setMessageType('error');
      return;
    }
    if (done) {
      if (submitResult?.status === 'PENDING') {
        setMessage('判题仍在处理中，请稍后在提交记录页查看');
        setMessageType('info');
      } else if (submitResult?.status) {
        setMessage(`判题完成：${submitResult.status}`);
        setMessageType(submitResult.status === 'AC' ? 'success' : 'error');
      }
    } else {
      setMessage('排队/判题中...');
      setMessageType('info');
    }
  }, [submissionId, done, submitResult, pollError]);

  function onLanguageChange(next: string) {
    if (next === language) return;
    const pristine = sourceCode === LANGUAGE_TEMPLATES[language] || sourceCode === LANGUAGE_TEMPLATES.python;
    setLanguage(next);
    if (pristine) setSourceCode(LANGUAGE_TEMPLATES[next] || '');
  }

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!isLoggedIn) {
      setMessage('请先登录');
      setMessageType('error');
      router.push('/login');
      return;
    }
    // Token 失效由 apiFetch 在 401 时统一处理（跳转登录），此处不再前置 isTokenExpired 检查
    if (!sourceCode.trim()) {
      setMessage('代码不能为空');
      setMessageType('error');
      return;
    }

    setSubmitting(true);
    setMessage('提交中...');
    setMessageType('info');
    try {
      const payload = await apiPost<{ submission_id: number; status: string }>('/api/judge/submit', {
        problem_id: problemId,
        language,
        source_code: sourceCode,
        stdin: ''
      });
      setSubmissionId(payload.data.submission_id);
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '提交失败'));
      setMessageType('error');
    } finally {
      setSubmitting(false);
    }
  }

  const messageStyle =
    messageType === 'error'
      ? { color: '#cf222e' }
      : messageType === 'success'
        ? { color: '#1a7f37' }
        : { color: '#656d76' };

  return (
    <main className="container">
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }} className="detail-grid">
          <div>
            {problem && (
              <section className="card fade-in" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span
                    className="brand-mark"
                    aria-hidden="true"
                    style={{ width: 34, height: 34, fontSize: 16 }}
                  >
                    {String(problemId).padStart(2, '0')}
                  </span>
                  <h1 style={{ fontSize: 22, margin: 0 }}>{problem.title}</h1>
                  <DifficultyBadge difficulty={problem.difficulty} />
                  <button
                    type="button"
                    className={favorited ? 'btn btn-sm' : 'btn btn-secondary btn-sm'}
                    onClick={() => void toggleFavorite()}
                    disabled={favPending}
                    style={{ marginLeft: 'auto' }}
                  >
                    {favorited ? '已收藏 ★' : '收藏 ☆'}
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  {(problem.tags || []).map((t) => (
                    <span key={t} style={{
                      display: 'inline-block', padding: '1px 10px', borderRadius: 12, fontSize: 12,
                      background: '#ddf4ff', color: '#0969da', marginRight: 6, marginTop: 4
                    }}>
                      {t}
                    </span>
                  ))}
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#656d76' }}>
                    通过率 {problem.submission_count > 0 ? `${problem.ac_rate}% (${problem.ac_count}/${problem.submission_count})` : '暂无提交'}
                  </span>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', color: '#363a42', lineHeight: 1.7, marginBottom: 0 }}>
                  {problem.description}
                </p>
              </section>
            )}

            <section className="card">
              <h2 className="card-title" style={{ marginBottom: 12 }}>样例测试用例</h2>
              {samples.length === 0 && <EmptyState text="暂无样例" />}
              {samples.map((s) => (
                <div key={s.id} style={{ marginBottom: 14 }}>
                  <p className="field-label" style={{ marginBottom: 4 }}>Input</p>
                  <pre style={{ marginTop: 0 }}>{s.input_data}</pre>
                  <p className="field-label" style={{ marginBottom: 4 }}>Expected</p>
                  <pre style={{ marginTop: 0 }}>{s.expected_output}</pre>
                </div>
              ))}
            </section>

            <SolutionsPanel problemId={problemId} isLoggedIn={isLoggedIn} />
          </div>

          <div>
            <form className="card" onSubmit={(e) => onSubmit(e)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <h2 className="card-title" style={{ marginBottom: 0 }}>代码提交</h2>
                <span className="kbd" title="快捷键">Ctrl + Enter</span>
              </div>
              <div className="input-group" style={{ marginTop: 12 }}>
                <label className="field-label" htmlFor="lang">语言</label>
                <select id="lang" style={{ width: '100%' }} value={language} onChange={(e) => onLanguageChange(e.target.value)} disabled={submitting}>
                  {LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label className="field-label" htmlFor="code">代码</label>
                <CodeEditor
                  value={sourceCode}
                  onChange={setSourceCode}
                  language={language}
                  disabled={submitting}
                  onCtrlEnter={() => void onSubmit()}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <LoadingButton loading={submitting} type="submit">提交代码</LoadingButton>
                {message && (
                  <span role="status" style={{ fontSize: 13, ...messageStyle }}>
                    {submitting ? '提交中...' : message}
                  </span>
                )}
              </div>
            </form>

            {submitResult && (
              <section className="card fade-in">
                <h2 className="card-title" style={{ marginBottom: 12 }}>判题结果</h2>
                <div className="submit-status">
                  <StatusBadge status={submitResult.status} />
                  {submitResult.status === 'PENDING' && <span className="spinner" aria-hidden="true" />}
                </div>
                <div className="result-grid">
                  <div className="result-item"><b>Submission ID</b>{submitResult.id}</div>
                  <div className="result-item"><b>Runtime</b>{submitResult.runtime_ms ?? '-'} ms</div>
                  <div className="result-item"><b>Memory</b>{submitResult.memory_kb ?? '-'} kb</div>
                </div>
                {submitResult.error_message && (
                  <p className="error">Error: {submitResult.error_message}</p>
                )}
                {submitResult.failed_case_input && (
                  <div style={{ marginTop: 8 }}>
                    <p className="field-label" style={{ marginBottom: 4 }}>Failed Case Input</p>
                    <pre style={{ marginTop: 0 }}>{submitResult.failed_case_input}</pre>
                    <p className="field-label" style={{ marginBottom: 4 }}>Expected Output</p>
                    <pre style={{ marginTop: 0 }}>{submitResult.expected_output || '-'}</pre>
                    <p className="field-label" style={{ marginBottom: 4 }}>Actual Output</p>
                    <pre style={{ marginTop: 0 }}>{submitResult.actual_output || '-'}</pre>
                  </div>
                )}
              </section>
            )}

            <RunPanel language={language} sourceCode={sourceCode} />
          </div>
        </div>
      </div>
    </main>
  );
}
