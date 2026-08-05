"use client";

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="container">
      <h1>出错了</h1>
      <p>页面发生错误，请稍后重试。</p>
      <button className="btn" onClick={reset} type="button">
        重试
      </button>
    </main>
  );
}
