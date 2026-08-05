"use client";

import { useState } from 'react';

export function Spinner({ label, size }: { label?: string; size?: 'sm' | 'lg' }) {
  return (
    <span className="spinner-wrap" role="status" aria-live="polite">
      <span className={`spinner${size === 'lg' ? ' spinner-lg' : ''}`} aria-hidden="true" />
      {label && <span className="spinner-label">{label}</span>}
    </span>
  );
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING: { label: '排队中', className: 'badge-pending' },
  AC: { label: '通过', className: 'badge-ac' },
  WA: { label: '答案错误', className: 'badge-wa' },
  CE: { label: '编译错误', className: 'badge-ce' },
  RE: { label: '运行错误', className: 'badge-re' },
  TLE: { label: '超时', className: 'badge-tle' },
  MLE: { label: '内存超限', className: 'badge-mle' }
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || { label: status, className: 'badge-pending' };
  return <span className={`badge ${meta.className}`}>{meta.label}</span>;
}

const DIFFICULTY_META: Record<string, { className: string }> = {
  EASY: { className: 'badge-easy' },
  MEDIUM: { className: 'badge-medium' },
  HARD: { className: 'badge-hard' }
};

export function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const meta = DIFFICULTY_META[difficulty] || { className: 'badge-pending' };
  return <span className={`badge ${meta.className}`}>{difficulty}</span>;
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">📭</span>
      <p>{text}</p>
    </div>
  );
}

export function LoadingButton({
  loading,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button {...rest} className={`btn ${className || ''}`} disabled={loading || rest.disabled}>
      {loading ? <Spinner label="处理中..." /> : children}
    </button>
  );
}

export function passwordStrength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  return { score, label: ['', '弱', '一般', '良好', '强'][score] };
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  hint
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const strength = passwordStrength(value);
  const colors = ['', '#cf222e', '#f0883e', '#9a6700', '#2ea043'];
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="password-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          style={{ width: '100%', paddingRight: 46 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? '隐藏密码' : '显示密码'}
        >
          {visible ? '隐藏' : '显示'}
        </button>
      </div>
      {strength.score > 0 && (
        <div className="strength-row">
          <div className="strength-bars">
            {[1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`strength-bar${i <= strength.score ? ' on' : ''}`}
                style={{ background: i <= strength.score ? colors[strength.score] : '#e5e9ee' }}
              />
            ))}
          </div>
          <span className="strength-label" style={{ color: colors[strength.score] }}>
            {strength.label}
          </span>
        </div>
      )}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}
