"use client";

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiGet, getErrorMessage } from '../../lib/api';
import type { AuditLog, ListResponse } from '../../lib/types';
import { Spinner } from '../../components/ui';
import AuthGate from '../../components/AuthGate';
import AdminPage from '../../components/AdminPage';

export default function AdminAuditPage() {
  return (
    <AuthGate admin>
      <AdminAuditInner />
    </AuthGate>
  );
}

const ACTION_LABELS: Record<string, string> = {
  'submission.enqueue': '提交入队',
  'submission.judged': '判题完成',
  'submission.rejudge': '重新判题',
  'submission.share': '分享提交',
  'problem.create': '创建题目',
  'problem.update': '更新题目',
  'problem.delete': '删除题目',
  'problem.bulk_create': '批量导入',
  'test_case.create': '创建用例',
  'test_case.update': '更新用例',
  'test_case.delete': '删除用例',
  'test_case.bulk': '批量用例',
  'user.update': '用户管理',
  'user.ban': '封禁用户',
  'user.unban': '解封用户',
  'announcement.create': '发布公告',
  'announcement.update': '更新公告',
  'announcement.delete': '删除公告',
  'daily_problem.set': '设置每日一题',
  'profile.update': '修改资料',
  'password.change': '修改密码',
  'run.submit': '试运行',
  'solution.create': '提交题解',
  'solution.review': '审核题解',
  'contest.create': '创建比赛',
  'contest.update': '更新比赛',
  'contest.delete': '删除比赛'
};

function AdminAuditInner() {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actor, setActor] = useState('');
  const [actorSearch, setActorSearch] = useState('');
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(15) });
      if (actorSearch) params.set('actor', actorSearch);
      if (action) params.set('action', action);
      const payload = await apiGet<ListResponse<AuditLog>>(`/api/admin/audit?${params}`);
      setItems(payload.data.items);
      setTotal(payload.data.total);
      setError('');
    } catch (err: unknown) {
      setError(getErrorMessage(err, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [page, actorSearch, action]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setActorSearch(actor.trim());
  }

  function formatDetail(detail: Record<string, unknown>): string {
    if (!detail || Object.keys(detail).length === 0) return '';
    try {
      const keys = Object.keys(detail);
      const parts: string[] = [];
      for (const k of keys) {
        const v = detail[k];
        parts.push(`${k}=${v === null || v === undefined ? '' : String(v)}`);
      }
      return parts.join(', ');
    } catch {
      return JSON.stringify(detail);
    }
  }

  return (
    <AdminPage title="审计日志" subtitle={`全站关键操作共 ${total} 条`}>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <form onSubmit={onSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            type="search"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="操作者用户名..."
            style={{ width: 150 }}
            aria-label="按操作者筛选"
          />
          <button type="submit" className="btn btn-secondary">筛选</button>
        </form>
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          aria-label="按操作类型筛选"
          style={{ width: 160 }}
        >
          <option value="">全部操作</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {loading && <Spinner label="加载审计日志中..." />}
      {!loading && items.length === 0 && <p>没有匹配的日志</p>}
      {!loading && items.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 56 }}>#</th>
                  <th>操作</th>
                  <th>操作者</th>
                  <th>对象</th>
                  <th>详情</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((log) => (
                  <tr key={log.id}>
                    <td style={{ color: '#656d76' }}>{log.id}</td>
                    <td>
                      <span title={log.action} style={{ color: '#1f2328' }}>
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td style={{ color: '#656d76' }}>
                      {log.actor_username ? (
                        <a href={`/users/${encodeURIComponent(log.actor_username)}`} style={{ color: '#0969da' }}>
                          {log.actor_username}
                        </a>
                      ) : '-'}
                    </td>
                    <td style={{ color: '#656d76', fontSize: 13 }}>
                      {log.resource_type}{log.resource_id ? ` #${log.resource_id}` : ''}
                    </td>
                    <td style={{ color: '#656d76', fontSize: 13, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatDetail(log.detail)}
                    </td>
                    <td style={{ color: '#656d76', fontSize: 13 }}>
                      {log.created_at ? new Date(log.created_at).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {total > 15 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span style={{ alignSelf: 'center', fontSize: 13, color: '#656d76' }}>
            第 {page} / {Math.ceil(total / 15)} 页
          </span>
          <button className="btn btn-secondary btn-sm" type="button" disabled={page * 15 >= total} onClick={() => setPage(page + 1)}>
            下一页
          </button>
        </div>
      )}

      {error && <p style={{ marginTop: 12, color: '#cf222e' }}>{error}</p>}
    </AdminPage>
  );
}
