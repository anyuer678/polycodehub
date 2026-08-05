"use client";

import { Spinner, EmptyState } from './ui';

export function Pagination({
  page,
  totalPages,
  onPageChange
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button className="btn btn-secondary btn-sm" type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        上一页
      </button>
      <span className="pagination-info">
        第 {page} / {totalPages} 页
      </span>
      <button className="btn btn-secondary btn-sm" type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        下一页
      </button>
    </div>
  );
}

export function LoadingCard({ label }: { label: string }) {
  return (
    <div className="card" aria-busy="true">
      <div className="card-loading">
        <Spinner label={label} size="lg" />
      </div>
    </div>
  );
}

export function ErrorText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="card" role="alert" style={{ borderColor: 'rgba(248, 81, 73, 0.4)', background: 'rgba(248, 81, 73, 0.06)' }}>
      <p className="error" style={{ margin: 0 }}>{text}</p>
    </div>
  );
}

export function EmptyCard({ text }: { text: string }) {
  return (
    <div className="card">
      <EmptyState text={text} />
    </div>
  );
}
