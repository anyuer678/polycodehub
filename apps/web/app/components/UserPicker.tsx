"use client";

import { useEffect, useRef, useState } from 'react';
import { apiGet, getErrorMessage } from '../lib/api';
import type { AdminUser } from '../lib/types';

export interface PickedUser {
  id: number;
  username: string;
  email: string;
  role: string;
}

interface UserPickerProps {
  selected: PickedUser | null;
  onSelect: (user: PickedUser | null) => void;
  placeholder?: string;
}

/**
 * 用户选择器：输入用户名/邮箱前缀，防抖搜索匹配用户，下拉选择。
 * 解决管理员只知道用户名不知道 ID 的痛点。选中后显示用户卡片，可清除重选。
 */
export default function UserPicker({ selected, onSelect, placeholder }: UserPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  // 点击外部关闭下拉
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // 防抖搜索
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    debounceRef.current = setTimeout(() => {
      void searchUsers(q);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function searchUsers(q: string) {
    const myId = ++reqIdRef.current;
    try {
      const res = await apiGet<{ items: AdminUser[] }>(
        `/api/admin/users?search=${encodeURIComponent(q)}&limit=10`
      );
      // 忽略过期请求（用户继续输入导致旧请求晚到）
      if (myId !== reqIdRef.current) return;
      setResults(
        res.data.items.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          role: u.role
        }))
      );
      if (res.data.items.length === 0) {
        setError('未找到匹配用户');
      }
    } catch (err) {
      if (myId !== reqIdRef.current) return;
      setError(getErrorMessage(err, '搜索失败'));
      setResults([]);
    } finally {
      if (myId === reqIdRef.current) setLoading(false);
    }
  }

  function handlePick(u: PickedUser) {
    onSelect(u);
    setQuery('');
    setResults([]);
    setOpen(false);
    setError('');
  }

  function handleClear() {
    onSelect(null);
    setQuery('');
    setResults([]);
  }

  // 已选中：显示用户卡片
  if (selected) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '6px 10px',
          border: '1px solid #d0d7de',
          borderRadius: 6,
          background: '#f6f8fa'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ color: '#0969da' }}>{selected.username}</strong>
          <span style={{ color: '#656d76', fontSize: 13 }}>
            ID: {selected.id} · {selected.email} · {selected.role}
          </span>
        </span>
        <button
          type="button"
          onClick={handleClear}
          style={{
            border: 'none',
            background: 'transparent',
            color: '#656d76',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '0 4px'
          }}
          aria-label="清除选择"
          title="清除选择"
        >
          ×
        </button>
      </div>
    );
  }

  // 未选中：显示搜索输入框 + 下拉
  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder || '输入用户名或邮箱搜索...'}
        style={{ width: '100%' }}
      />
      {open && (query.trim() || loading || error) && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            border: '1px solid #d0d7de',
            borderRadius: 6,
            background: '#fff',
            boxShadow: '0 8px 24px rgba(140,149,159,0.2)',
            zIndex: 100,
            maxHeight: 320,
            overflowY: 'auto'
          }}
        >
          {loading && (
            <div style={{ padding: '10px 12px', color: '#656d76' }}>搜索中...</div>
          )}
          {!loading && error && (
            <div style={{ padding: '10px 12px', color: '#656d76' }}>{error}</div>
          )}
          {!loading &&
            results.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => handlePick(u)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f6f8fa'
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = '#f6f8fa';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span>
                    <strong style={{ color: '#0969da' }}>{u.username}</strong>
                    <span style={{ color: '#656d76', marginLeft: 8, fontSize: 13 }}>{u.email}</span>
                  </span>
                  <span style={{ color: '#656d76', fontSize: 12, whiteSpace: 'nowrap' }}>
                    ID: {u.id} · {u.role}
                  </span>
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
