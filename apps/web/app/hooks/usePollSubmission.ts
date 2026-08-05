"use client";

import { useEffect, useRef, useState } from 'react';
import { apiGet, getErrorMessage } from '../lib/api';
import type { SubmissionDetail } from '../lib/types';

interface PollOptions {
  maxAttempts?: number;
  intervalMs?: number;
}

interface PollResult {
  item: SubmissionDetail | null;
  done: boolean;
  error: string;
}

const DEFAULT_OPTIONS: Required<PollOptions> = {
  maxAttempts: 25,
  intervalMs: 1200
};

export function usePollSubmission(submissionId: number | null, options?: PollOptions): PollResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const [item, setItem] = useState<SubmissionDetail | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!submissionId) return;
    setItem(null);
    setDone(false);
    setError('');

    let cancelled = false;
    let attempts = 0;

    async function poll() {
      if (cancelled) return;
      try {
        const payload = await apiGet<SubmissionDetail>(`/api/submissions/${submissionId}`);
        if (cancelled) return;
        setItem(payload.data);
        if (payload.data.status !== 'PENDING' || attempts >= opts.maxAttempts) {
          setDone(true);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(getErrorMessage(err, '查询判题结果失败'));
        setDone(true);
        return;
      }
      attempts += 1;
      timerRef.current = setTimeout(poll, opts.intervalMs);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [submissionId, opts.maxAttempts, opts.intervalMs]);

  return { item, done, error };
}
