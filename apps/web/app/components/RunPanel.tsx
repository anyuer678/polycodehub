"use client";

import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, getErrorMessage } from '../lib/api';
import type { RunResult } from '../lib/types';
import { LoadingButton, Spinner } from './ui';

interface RunPanelProps {
  language: string;
  sourceCode: string;
}

const FINAL_STATUSES = ['OK', 'RE', 'CE', 'TLE', 'MLE', 'WA'];

export default function RunPanel({ language, sourceCode }: RunPanelProps) {
  const [stdin, setStdin] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function stopPolling() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function onRun() {
    setError('');
    setResult(null);
    setRunning(true);
    stopPolling();
    try {
      const payload = await apiPost<{ run_id: number; status: string }>('/api/judge/run', {
        language,
        source_code: sourceCode,
        stdin
      });
      poll(payload.data.run_id);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '试运行失败'));
      setRunning(false);
    }
  }

  function poll(id: number) {
    stopPolling();
    timerRef.current = setInterval(async () => {
      try {
        const payload = await apiGet<RunResult>(`/api/judge/runs/${id}`);
        setResult(payload.data);
        if (FINAL_STATUSES.includes(payload.data.status)) {
          stopPolling();
          setRunning(false);
        }
      } catch (err: unknown) {
        stopPolling();
        setRunning(false);
        setError(getErrorMessage(err, '查询运行结果失败'));
      }
    }, 1000);
  }

  const statusLabel: Record<string, { text: string; color: string }> = {
    PENDING: { text: '运行中...', color: '#9a6700' },
    OK: { text: '运行成功', color: '#1a7f37' },
    CE: { text: '编译错误', color: '#cf222e' },
    RE: { text: '运行错误', color: '#cf222e' },
    TLE: { text: '超时', color: '#cf222e' },
    MLE: { text: '内存超限', color: '#cf222e' },
    WA: { text: '运行完成（无预期输出比较）', color: '#9a6700' }
  };

  return (
    <section className="card">
      <h2 className="card-title" style={{ marginBottom: 0 }}>试运行</h2>
      <div className="input-group" style={{ marginTop: 10 }}>
        <label className="field-label" htmlFor="run-stdin">自定义输入（stdin）</label>
        <textarea
          id="run-stdin"
          value={stdin}
          onChange={(e) => setStdin(e.target.value)}
          rows={4}
          placeholder={'输入测试数据，例如：\n5 3\n1 2 3 4 5'}
          style={{ width: '100%', resize: 'vertical', fontFamily: 'Consolas, monospace', fontSize: 13 }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <LoadingButton loading={running} type="button" onClick={() => void onRun()}>
          运行
        </LoadingButton>
        {running && <span style={{ fontSize: 13, color: '#9a6700' }}>执行中，最多 2 秒...</span>}
        {error && <span className="error" style={{ fontSize: 13 }}>{error}</span>}
      </div>

      {result && (
        <div className="fade-in" style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 6px', fontSize: 13 }}>
            <b>状态：</b>
            <span style={{ color: statusLabel[result.status]?.color || '#57606a' }}>
              {statusLabel[result.status]?.text || result.status}
            </span>
            <span style={{ marginLeft: 10, color: '#656d76' }}>
              耗时 {result.runtime_ms ?? '-'} ms
            </span>
          </p>
          {result.status === 'PENDING' && (
            <p style={{ margin: 0 }}><Spinner label="运行中..." /></p>
          )}
          {result.status !== 'PENDING' && (
            <>
              {result.stdout != null && (
                <>
                  <p className="field-label" style={{ margin: '8px 0 4px' }}>标准输出</p>
                  <pre style={{ marginTop: 0 }}>{result.stdout || '(空)'}</pre>
                </>
              )}
              {result.stderr != null && (
                <>
                  <p className="field-label" style={{ margin: '8px 0 4px' }}>错误信息</p>
                  <pre style={{ marginTop: 0 }}>{result.stderr || '(空)'}</pre>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
