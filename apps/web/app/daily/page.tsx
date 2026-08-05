"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '../lib/api';
import { Spinner } from '../components/ui';

interface DailyHistoryItem {
  date: string;
  problem_id: number;
  title: string;
  difficulty: string;
  status: string;
  end_type: string | null;
  ended_at: string | null;
  result: {
    submissions: number;
    ac_users: number;
    pass_rate: number;
    fastest: { username: string; runtime_ms: number } | null;
  } | null;
}

export default function DailyHistoryPage() {
  const [items, setItems] = useState<DailyHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiGet<{ items: DailyHistoryItem[] }>('/api/daily-problem/history')
      .then((payload) => {
        if (!cancelled) setItems(payload.data.items);
      })
      .catch(() => {
        if (!cancelled) setError('加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="container">
      <h1>每日一题历史</h1>
      {loading && <Spinner label="加载中..." />}
      {!loading && error && <p className="error">{error}</p>}
      {!loading && !error && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>题目</th>
                  <th>难度</th>
                  <th>状态</th>
                  <th>提交</th>
                  <th>AC 人数</th>
                  <th>通过率</th>
                  <th>最快</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.date}>
                    <td style={{ color: '#656d76' }}>{item.date}</td>
                    <td>
                      <Link href={`/problems/${item.problem_id}`} style={{ color: '#0969da' }}>{item.title}</Link>
                    </td>
                    <td>
                      <span className="badge" style={{ background: item.difficulty === 'EASY' ? '#dafbe1' : item.difficulty === 'MEDIUM' ? '#fff1e5' : '#ffebe9', color: item.difficulty === 'EASY' ? '#1a7f37' : item.difficulty === 'MEDIUM' ? '#9a6700' : '#cf222e' }}>
                        {item.difficulty}
                      </span>
                    </td>
                    <td>
                      <span className="badge" style={item.status === 'finished' ? { background: '#dafbe1', color: '#1a7f37' } : { background: '#fff8c5', color: '#7d4e00' }}>
                        {item.status === 'finished' ? (item.end_type === 'manual' ? '已提前结束' : '已结束') : '进行中'}
                      </span>
                    </td>
                    <td style={{ color: '#656d76' }}>{item.result ? item.result.submissions : '-'}</td>
                    <td style={{ color: '#656d76' }}>{item.result ? item.result.ac_users : '-'}</td>
                    <td style={{ color: '#656d76' }}>{item.result ? `${item.result.pass_rate}%` : '-'}</td>
                    <td style={{ color: '#656d76' }}>
                      {item.result?.fastest
                        ? `${item.result.fastest.username}（${item.result.fastest.runtime_ms} ms）`
                        : '-'}
                    </td>
                    <td>
                      <Link className="btn btn-ghost btn-sm" href={`/problems/${item.problem_id}`}>
                        查看题目
                      </Link>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: '#656d76' }}>暂无记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
