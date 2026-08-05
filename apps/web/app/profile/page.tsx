"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGet, apiDelete, apiPut, getErrorMessage } from '../lib/api';
import type { FavoriteItem, SolvedItem, Submission, ListResponse, Announcement, Notification, NotificationListResponse, BadgeSet } from '../lib/types';
import { StatusBadge, DifficultyBadge } from '../components/ui';
import { LoadingCard, ErrorText, EmptyCard, Pagination } from '../components/data';
import { useAuth } from '../hooks/useAuth';
import AuthGate from '../components/AuthGate';

type BanStatus = {
  banned: boolean;
  ban_reason: string | null;
  banned_until: string | null;
};

type UserStats = {
  total_submissions: string | number;
  accepted_submissions: string | number;
  solved_problems: string | number;
  last_submitted_at: string | null;
};

export default function ProfilePage() {
  return (
    <AuthGate>
      <ProfileInner />
    </AuthGate>
  );
}

function ProfileInner() {
  const { user } = useAuth();

  const [stats, setStats] = useState<UserStats | null>(null);
  const [items, setItems] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favLoading, setFavLoading] = useState(true);
  const [solved, setSolved] = useState<SolvedItem[]>([]);
  const [solvedLoading, setSolvedLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banStatus, setBanStatus] = useState<BanStatus | null>(null);
  const [pinnedAnnouncement, setPinnedAnnouncement] = useState<Announcement | null>(null);
  const [pinnedDismissed, setPinnedDismissed] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifLoading, setNotifLoading] = useState(true);
  const [badges, setBadges] = useState<BadgeSet | null>(null);
  const [badgesLoading, setBadgesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setFavLoading(true);
    apiGet<{ items: FavoriteItem[] }>('/api/users/me/favorites')
      .then((r) => {
        if (!cancelled) setFavorites(r.data.items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setFavLoading(false);
      });
    apiGet<{ items: SolvedItem[] }>('/api/users/me/solved')
      .then((r) => {
        if (!cancelled) setSolved(r.data.items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSolvedLoading(false);
      });
    // 拉取最新封禁状态（即使 useAuth 中的 user 已含字段，也重新拉取保证最新）
    apiGet<BanStatus & { id: number; username: string; email: string; role: string }>('/api/users/me')
      .then((r) => {
        if (!cancelled) {
          setBanStatus({
            banned: Boolean(r.data.banned),
            ban_reason: r.data.ban_reason ?? null,
            banned_until: r.data.banned_until ?? null
          });
        }
      })
      .catch(() => undefined);
    // 拉取最新一条置顶公告（强通知横幅）
    apiGet<ListResponse<Announcement>>('/api/announcements?pinned=true&limit=1')
      .then((r) => {
        if (!cancelled && r.data.items.length > 0) setPinnedAnnouncement(r.data.items[0]);
      })
      .catch(() => undefined);
    // 拉取站内信列表（最新 10 条，含未读数）
    setNotifLoading(true);
    apiGet<NotificationListResponse>('/api/notifications?page=1&limit=10')
      .then((r) => {
        if (!cancelled) {
          setNotifications(r.data.items);
          setNotifUnread(r.data.unread);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setNotifLoading(false);
      });
    // 拉取成就徽章
    apiGet<BadgeSet>('/api/users/me/badges')
      .then((r) => {
        if (!cancelled) setBadges(r.data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setBadgesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 检查本次会话是否已 dismiss 该置顶公告
  useEffect(() => {
    if (pinnedAnnouncement && typeof window !== 'undefined') {
      const key = `polycodehub_dismissed_pinned_${pinnedAnnouncement.id}`;
      if (window.sessionStorage.getItem(key)) setPinnedDismissed(true);
    }
  }, [pinnedAnnouncement]);

  function dismissPinned() {
    if (pinnedAnnouncement && typeof window !== 'undefined') {
      window.sessionStorage.setItem(
        `polycodehub_dismissed_pinned_${pinnedAnnouncement.id}`,
        '1'
      );
    }
    setPinnedDismissed(true);
  }

  // 标记单条通知已读：乐观更新，失败回滚
  async function markAsRead(id: number) {
    const prev = notifications;
    setNotifications((cur) => cur.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setNotifUnread((u) => Math.max(0, u - 1));
    try {
      await apiPut(`/api/notifications/${id}/read`, {});
    } catch {
      setNotifications(prev);
      setNotifUnread((u) => u + 1);
    }
  }

  // 全部标记已读
  async function markAllRead() {
    const prevUnread = notifUnread;
    setNotifications((cur) => cur.map((n) => ({ ...n, is_read: true })));
    setNotifUnread(0);
    try {
      await apiPut('/api/notifications/read-all', {});
    } catch {
      setNotifUnread(prevUnread);
    }
  }

  async function unFavorite(id: number) {
    try {
      await apiDelete(`/api/users/me/favorites/${id}`);
      setFavorites((prev) => prev.filter((f) => f.id !== id));
    } catch {
      setError(getErrorMessage(new Error('取消失败'), '操作失败'));
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiGet<UserStats>('/api/users/me/stats'),
      apiGet<ListResponse<Submission>>(`/api/submissions?page=${page}&limit=8`)
    ])
      .then(([statsPayload, subPayload]) => {
        if (cancelled) return;
        setStats(statsPayload.data);
        setItems(subPayload.data.items);
        setTotal(subPayload.data.total);
        setError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, '加载失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  const totalNum = Number(stats?.total_submissions ?? 0);
  const acceptedNum = Number(stats?.accepted_submissions ?? 0);
  const rate = totalNum > 0 ? Math.round((acceptedNum / totalNum) * 100) : 0;

  // 封禁状态展示：当前生效中 或 历史已解封均展示，便于用户自查
  const banActive = banStatus?.banned && (!banStatus.banned_until || new Date(banStatus.banned_until).getTime() > Date.now());

  return (
    <main className="container">
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div className="card fade-in" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 24 }}>
          <span
            className="brand-mark"
            aria-hidden="true"
            style={{ width: 56, height: 56, fontSize: 26, borderRadius: 12 }}
          >
            {user?.username?.slice(0, 1).toUpperCase() || '?'}
          </span>
          <div>
            <h1 style={{ fontSize: 20, margin: 0 }}>{user?.username}</h1>
            <p style={{ margin: 4, color: '#656d76', fontSize: 13 }}>
              UID {user?.id} · {user?.email}
            </p>
          </div>
          <Link href={`/users/${encodeURIComponent(user?.username || '')}`} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>
            查看我的公开主页 →
          </Link>
          <span className="badge badge-ac" style={{ marginLeft: 8 }}>
            {user?.role === 'admin' ? '管理员' : user?.role === 'teacher' ? '教师' : '用户'}
          </span>
        </div>

        {banStatus && banStatus.banned && (
          <div
            className="card fade-in"
            role="status"
            style={{
              marginTop: 16,
              padding: '14px 16px',
              background: banActive ? '#ffebe9' : '#fff8c5',
              border: `1px solid ${banActive ? '#ff8182' : '#d4a72c'}`,
              borderLeft: `4px solid ${banActive ? '#cf222e' : '#bf8700'}`,
              color: banActive ? '#82071e' : '#7d4e00',
              fontSize: 13,
              lineHeight: 1.7
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {banActive ? '⛔ 当前账号处于封禁状态' : '⚠️ 该账号存在历史封禁记录（已解封）'}
            </div>
            {banStatus.ban_reason && (
              <div>原因：{banStatus.ban_reason}</div>
            )}
            <div>
              解封时间：
              {banStatus.banned_until
                ? new Date(banStatus.banned_until).toLocaleString()
                : '永久（需联系管理员）'}
            </div>
            {banActive && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#82071e' }}>
                封禁期间无法提交代码与访问受保护接口；如有异议请联系管理员申诉。
              </div>
            )}
          </div>
        )}

        {pinnedAnnouncement && !pinnedDismissed && (
          <div
            className="card fade-in"
            role="status"
            style={{
              marginTop: 16,
              padding: '14px 16px',
              background: 'linear-gradient(90deg, #ddf4ff, #ffffff)',
              border: '1px solid #0969da',
              borderLeft: '4px solid #0969da',
              color: '#1f2328',
              fontSize: 13,
              lineHeight: 1.7
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span
                className="badge"
                style={{ background: '#0969da', color: '#fff', borderColor: '#0969da' }}
              >
                置顶公告
              </span>
              <b style={{ fontSize: 14 }}>{pinnedAnnouncement.title}</b>
              <button
                type="button"
                onClick={dismissPinned}
                aria-label="关闭横幅"
                style={{
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: 'none',
                  color: '#57606a',
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: 1,
                  padding: '0 4px'
                }}
              >
                ×
              </button>
            </div>
            <p style={{ margin: '0 0 8px', color: '#363a42', whiteSpace: 'pre-wrap' }}>
              {pinnedAnnouncement.content}
            </p>
            <Link
              href="/announcements"
              style={{ color: '#0969da', fontSize: 12, textDecoration: 'none' }}
            >
              查看全部公告 →
            </Link>
          </div>
        )}

        {loading && <LoadingCard label="加载统计中..." />}
        {!loading && error && <ErrorText text={error} />}

        {!loading && !error && stats && (
          <div
            className="fade-in"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 12,
              marginBottom: 16
            }}
          >
            {[
              { label: '提交总数', value: totalNum },
              { label: '通过提交', value: acceptedNum, color: '#1a7f37' },
              { label: '解题数', value: Number(stats.solved_problems ?? 0), color: '#0969da' },
              { label: '通过率', value: `${rate}%`, color: rate >= 50 ? '#1a7f37' : '#9a6700' }
            ].map((item) => (
              <div key={item.label} className="card" style={{ margin: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: item.color ?? '#1f2328' }}>{item.value}</div>
                <div style={{ fontSize: 12, color: '#656d76', marginTop: 4 }}>{item.label}</div>
              </div>
            ))}
          </div>
        )}

        <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          我的通知
          {notifUnread > 0 && (
            <span className="badge" style={{ background: '#cf222e', color: '#fff', borderColor: '#cf222e' }}>
              {notifUnread} 未读
            </span>
          )}
          {notifUnread > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => void markAllRead()}
            >
              全部标为已读
            </button>
          )}
        </h2>
        {notifLoading && <LoadingCard label="加载通知中..." />}
        {!notifLoading && notifications.length === 0 && <EmptyCard text="暂无通知" />}
        {!notifLoading && notifications.length > 0 && (
          <div className="card fade-in" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {notifications.map((n) => (
                <li
                  key={n.id}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #d0d7de',
                    background: n.is_read ? 'transparent' : '#ddf4ff',
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start'
                  }}
                >
                  <span
                    className="badge"
                    style={{
                      background: typeColor(n.type),
                      color: '#fff',
                      borderColor: typeColor(n.type),
                      flexShrink: 0
                    }}
                  >
                    {typeLabel(n.type)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: n.is_read ? 500 : 700, color: '#1f2328' }}>
                      {n.title}
                    </div>
                    {n.content && (
                      <div style={{ fontSize: 13, color: '#656d76', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                        {n.content}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: '#8c959f', marginTop: 4 }}>
                      {n.sender_name ? (
                        <>发送者：<Link href={`/users/${n.sender_name}`} style={{ color: '#0969da' }}>{n.sender_name}</Link> · </>
                      ) : (
                        <>发送者：系统 · </>
                      )}
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </div>
                  {!n.is_read && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ flexShrink: 0 }}
                      onClick={() => void markAsRead(n.id)}
                    >
                      标为已读
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <h2 className="page-title">我的徽章</h2>
        {badgesLoading && <LoadingCard label="加载徽章中..." />}
        {!badgesLoading && badges && (
          <div className="card fade-in" style={{ padding: '16px 18px', marginBottom: 24 }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#656d76' }}>
              已获得 {badges.items.filter((b) => b.earned).length} / {badges.items.length} · 连续 AC 打卡 {badges.streak} 天
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {badges.items.map((b) => (
                <div
                  key={b.code}
                  title={b.desc}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${b.earned ? '#0969da' : '#d0d7de'}`,
                    background: b.earned ? '#f0f7ff' : '#f6f8fa',
                    opacity: b.earned ? 1 : 0.55
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 34,
                      height: 34,
                      flexShrink: 0,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      background: b.earned ? '#0969da' : '#d8dee4',
                      color: '#fff'
                    }}
                  >
                    {b.earned ? badgeIcon(b.code) : '?'}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: b.earned ? '#0969da' : '#57606a' }}>
                      {b.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#656d76', lineHeight: 1.4 }}>
                      {b.earned ? b.desc : '未达成'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <h2 className="page-title">已 AC 题目</h2>
        {solvedLoading && <LoadingCard label="加载已解题中..." />}
        {!solvedLoading && solved.length === 0 && <EmptyCard text="还没有通过任何题目，去题库试试吧" />}
        {!solvedLoading && solved.length > 0 && (
          <div className="card fade-in" style={{ padding: '12px 16px', marginBottom: 24 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {solved.map((s) => (
                <Link
                  key={s.id}
                  href={`/problems/${s.id}`}
                  className="btn btn-sm"
                  style={{ borderColor: '#d8dee4', background: '#f6f8fa', color: '#1f2328', fontSize: 12 }}
                >
                  <span style={{ color: '#1a7f37', marginRight: 4 }}>✓</span>
                  {s.title}
                </Link>
              ))}
            </div>
          </div>
        )}

        <h2 className="page-title">我的收藏</h2>
        {favLoading && <LoadingCard label="加载收藏中..." />}
        {!favLoading && favorites.length === 0 && <EmptyCard text="还没有收藏题目，去题库逛逛吧" />}
        {!favLoading && favorites.length > 0 && (
          <div className="card fade-in" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
            <div className="table-wrap" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 64 }}>#</th>
                    <th>题目</th>
                    <th style={{ width: 110 }}>难度</th>
                    <th style={{ width: 90, textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {favorites.map((f) => (
                    <tr key={f.id}>
                      <td style={{ color: '#656d76', fontFamily: 'Consolas, monospace' }}>
                        {String(f.id).padStart(2, '0')}
                      </td>
                      <td>
                        <Link href={`/problems/${f.id}`} style={{ color: '#1f2328', fontWeight: 500 }}>
                          {f.title}
                        </Link>
                        <div style={{ fontSize: 12, color: '#656d76' }}>
                          {(f.tags || []).join(' · ') || '无标签'}
                        </div>
                      </td>
                      <td><DifficultyBadge difficulty={f.difficulty} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void unFavorite(f.id)}>
                          取消收藏
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <h2 className="page-title">最近提交</h2>
        {loading && <LoadingCard label="加载提交记录中..." />}
        {!loading && error && <ErrorText text={error} />}
        {!loading && !error && items.length === 0 && <EmptyCard text="还没有提交记录，去题库试试吧" />}
        {!loading && !error && items.length > 0 && (
          <div className="card fade-in" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>题目</th>
                    <th>语言</th>
                    <th>状态</th>
                    <th>耗时</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <tr key={s.id}>
                      <td style={{ color: '#656d76' }}>{s.id}</td>
                      <td>
                        <Link href={`/submissions/${s.id}`} style={{ color: '#1f2328' }}>
                          {s.problem_title || `#${s.problem_id}`}
                        </Link>
                      </td>
                      <td style={{ color: '#656d76' }}>{s.language}</td>
                      <td><StatusBadge status={s.status} /></td>
                      <td style={{ color: '#656d76' }}>{s.runtime_ms != null ? `${s.runtime_ms} ms` : '-'}</td>
                      <td style={{ color: '#656d76', fontSize: 13 }}>
                        {s.created_at ? new Date(s.created_at).toLocaleString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <Pagination page={page} totalPages={Math.ceil(total / 8)} onPageChange={setPage} />
      </div>
    </main>
  );
}

// 通知类型 → 中文标签
function typeLabel(t: string): string {
  switch (t) {
    case 'system':
      return '系统';
    case 'announcement':
      return '公告';
    case 'submission':
      return '判题';
    default:
      return '其他';
  }
}

// 徽章 → 图标字符
function badgeIcon(code: string): string {
  switch (code) {
    case 'first_blood': return '⚔';
    case 'solved_5': return '🥉';
    case 'solved_10': return '🥈';
    case 'solved_20': return '🥇';
    case 'sub_50': return '📚';
    case 'sub_100': return '🔥';
    case 'streak_3': return '📅';
    case 'streak_7': return '⏳';
    case 'all_rounder': return '🌟';
    default: return '🏅';
  }
}

// 通知类型 → badge 颜色（GitHub 风格）
function typeColor(t: string): string {
  switch (t) {
    case 'system':
      return '#0969da';
    case 'announcement':
      return '#1a7f37';
    case 'submission':
      return '#8250df';
    default:
      return '#656d76';
  }
}