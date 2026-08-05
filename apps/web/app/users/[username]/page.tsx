"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiGet, apiPut, apiDelete, apiPost, getErrorMessage } from '../../lib/api';
import type { PublicUser, FollowUser, ProfileMessage, BadgeSet } from '../../lib/types';
import { Spinner, DifficultyBadge } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';

type Visibility = 'public' | 'hidden' | 'self';

const MODULE_LABELS: Record<string, string> = {
  heatmap: 'AC 热力图',
  solved: '已 AC 题目',
  messages: '留言板',
  social: '粉丝 / 关注',
  badges: '徽章'
};

const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: '所有人可见',
  self: '仅自己可见',
  hidden: '隐藏'
};

export default function PublicProfilePage() {
  const params = useParams<{ username: string }>();
  const { user: me } = useAuth();

  const [user, setUser] = useState<PublicUser | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [followBusy, setFollowBusy] = useState(false);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [followers, setFollowers] = useState<FollowUser[]>([]);
  const [following, setFollowing] = useState<FollowUser[]>([]);
  const [messages, setMessages] = useState<ProfileMessage[]>([]);
  const [msgText, setMsgText] = useState('');
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgError, setMsgError] = useState('');
  const [badges, setBadges] = useState<BadgeSet | null>(null);
  const [localModules, setLocalModules] = useState<Record<string, Visibility> | null>(null);
  const [modSaving, setModSaving] = useState(false);

  const load = useCallback(() => {
    apiGet<PublicUser>(`/api/users/${encodeURIComponent(params.username)}`)
      .then((payload) => setUser(payload.data))
      .catch((err: unknown) => setError(getErrorMessage(err, '用户不存在')));
  }, [params.username]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiGet<PublicUser>(`/api/users/${encodeURIComponent(params.username)}`)
      .then((payload) => {
        if (cancelled) return;
        setUser(payload.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, '用户不存在'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [params.username]);

  useEffect(() => {
    let cancelled = false;
    if (user && (user.modules?.['messages'] ?? 'public') !== 'hidden') {
      apiGet<{ items: ProfileMessage[] }>(`/api/users/${encodeURIComponent(params.username)}/messages`)
        .then((payload) => {
          if (!cancelled) setMessages(payload.data.items);
        })
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [params.username, user?.id]);

  useEffect(() => {
    let cancelled = false;
    if (user && (user.modules?.['badges'] ?? 'public') !== 'hidden') {
      apiGet<BadgeSet>(`/api/users/${encodeURIComponent(params.username)}/badges`)
        .then((payload) => {
          if (!cancelled) setBadges(payload.data);
        })
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [params.username, user?.id]);

  async function toggleFollow() {
    if (!user) return;
    setFollowBusy(true);
    try {
      if (user.followed_by_me) {
        await apiDelete(`/api/users/${user.id}/follow`);
      } else {
        await apiPut(`/api/users/${user.id}/follow`, {});
      }
      await load();
    } catch {
      // 失败保持原状态
    } finally {
      setFollowBusy(false);
    }
  }

  async function openList(kind: 'followers' | 'following') {
    if (kind === 'followers') {
      setShowFollowers(true);
      setShowFollowing(false);
      try {
        const payload = await apiGet<{ items: FollowUser[] }>(`/api/users/${encodeURIComponent(params.username)}/followers`);
        setFollowers(payload.data.items);
      } catch { setFollowers([]); }
    } else {
      setShowFollowing(true);
      setShowFollowers(false);
      try {
        const payload = await apiGet<{ items: FollowUser[] }>(`/api/users/${encodeURIComponent(params.username)}/following`);
        setFollowing(payload.data.items);
      } catch { setFollowing([]); }
    }
  }

  async function postMessage() {
    const content = msgText.trim();
    if (!content) return;
    setMsgBusy(true);
    setMsgError('');
    try {
      const payload = await apiPost<ProfileMessage>(`/api/users/${encodeURIComponent(params.username)}/messages`, { content });
      setMessages((prev) => [payload.data, ...prev]);
      setMsgText('');
    } catch (err: unknown) {
      setMsgError(getErrorMessage(err, '留言失败'));
    } finally {
      setMsgBusy(false);
    }
  }

  const heatmap = useMemo(() => {
    if (!user) return [];
    const byDate = new Map<string, number>();
    for (const a of user.activity) byDate.set(a.date, a.count);

    const cells: Array<{ date: string; count: number; day: number }> = [];
    const end = new Date();
    for (let i = 89; i >= 0; i -= 1) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      cells.push({ date: key, count: byDate.get(key) || 0, day: d.getDay() });
    }
    return cells;
  }, [user]);

  function heatColor(count: number): string {
    if (count === 0) return '#ebedf0';
    if (count === 1) return '#9be9a8';
    if (count <= 3) return '#40c463';
    if (count <= 6) return '#30a14e';
    return '#216e39';
  }

  const maxCount = useMemo(() => Math.max(0, ...heatmap.map((c) => c.count)), [heatmap]);
  const activeDays = useMemo(() => heatmap.filter((c) => c.count > 0).length, [heatmap]);
  const isSelf = me !== null && user !== null && me.id === user.id;
  // 模块可见性：后端已按访客视角过滤（他人的 self 显示为 hidden），前端只需隐藏 hidden
  const mod = localModules ?? user?.modules ?? {};
  const visible = (key: string) => mod[key] !== 'hidden';

  // 本人视角：切换模块可见性（乐观更新，失败回滚）
  async function saveModule(key: string, v: Visibility) {
    if (!user) return;
    const prev = localModules ?? user?.modules ?? {};
    const next = { ...prev, [key]: v };
    setLocalModules(next);
    setModSaving(true);
    try {
      await apiPut<{ modules: Record<string, Visibility> }>('/api/users/me/home-modules', { modules: next });
    } catch {
      setLocalModules(prev);
    } finally {
      setModSaving(false);
    }
  }

  return (
    <main className="container">
      <h1>{params.username} 的主页</h1>
      {loading && <Spinner label="加载中..." />}
      {!loading && error && <p className="error">{error}</p>}

      {user && (
        <>
          {isSelf && (
            <section className="card fade-in" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                自定义主页模块
                {modSaving && <span style={{ fontSize: 12, color: '#656d76', fontWeight: 400 }}>保存中...</span>}
              </h2>
              <p style={{ fontSize: 13, color: '#656d76', marginTop: 0 }}>
                访客看到的效果：隐藏的模块完全不显示；仅自己可见的模块只有你自己能看到。
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Object.entries(MODULE_LABELS).map(([key, label]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, width: 100 }}>{label}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['public', 'self', 'hidden'] as Visibility[]).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => void saveModule(key, v)}
                          style={{
                            padding: '3px 10px',
                            borderRadius: 6,
                            border: '1px solid #d0d7de',
                            cursor: 'pointer',
                            fontSize: 12,
                            background: (mod[key] ?? 'public') === v ? '#0969da' : '#fff',
                            color: (mod[key] ?? 'public') === v ? '#fff' : '#57606a'
                          }}
                        >
                          {VISIBILITY_LABELS[v]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="card fade-in" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span
                className="brand-mark"
                aria-hidden="true"
                style={{ width: 46, height: 46, fontSize: 20, background: '#0969da', color: '#fff', borderColor: '#0969da' }}
              >
                {user.username.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{user.username}</div>
                <div style={{ fontSize: 13, color: '#656d76' }}>
                  {user.role === 'admin' ? '管理员' : user.role === 'teacher' ? '教师' : '用户'} · 注册于 {new Date(user.created_at).toLocaleDateString()}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                {isSelf && (
                  <>
                    <Link href="/settings" className="btn btn-ghost btn-sm">⚙ 模块设置</Link>
                    <Link href="/profile" className="btn btn-ghost btn-sm">个人中心 →</Link>
                  </>
                )}
                {!isSelf && me && (
                  <button
                    type="button"
                    className={user.followed_by_me ? 'btn btn-ghost btn-sm' : 'btn btn-sm'}
                    disabled={followBusy}
                    onClick={() => void toggleFollow()}
                  >
                    {user.followed_by_me ? '已关注' : '关注'}
                  </button>
                )}
                {user.banned && (
                  <span
                    className="badge"
                    style={{
                      background: '#ffebe9',
                      color: '#cf222e',
                      border: '1px solid #ff8182'
                    }}
                    title={user.ban_reason || '该账号已封禁'}
                  >
                    ⛔ 已封禁
                  </span>
                )}
              </div>
            </div>
            {user.banned && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  background: '#ffebe9',
                  border: '1px solid #ff8182',
                  borderLeft: '4px solid #cf222e',
                  borderRadius: 6,
                  color: '#82071e',
                  fontSize: 13,
                  lineHeight: 1.6
                }}
              >
                {user.ban_reason && <div>原因：{user.ban_reason}</div>}
                <div>
                  解封时间：
                  {user.banned_until
                    ? new Date(user.banned_until).toLocaleString()
                    : '永久（需联系管理员）'}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 24, marginTop: 14, flexWrap: 'wrap' }}>
              {visible('solved') && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{user.solved_count}</div>
                  <div style={{ fontSize: 12, color: '#656d76' }}>已 AC 题目</div>
                </div>
              )}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{user.ac_count}</div>
                <div style={{ fontSize: 12, color: '#656d76' }}>AC 提交</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{user.submissions}</div>
                <div style={{ fontSize: 12, color: '#656d76' }}>总提交</div>
              </div>
              {visible('heatmap') && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{activeDays}</div>
                  <div style={{ fontSize: 12, color: '#656d76' }}>近 90 天活跃天数</div>
                </div>
              )}
              {visible('social') && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ alignSelf: 'flex-end', marginLeft: 4 }}
                    onClick={() => void openList('followers')}
                    title="查看粉丝"
                  >
                    粉丝 {user.follower_count}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ alignSelf: 'flex-end' }}
                    onClick={() => void openList('following')}
                    title="查看关注"
                  >
                    关注 {user.following_count}
                  </button>
                </>
              )}
            </div>
            {(showFollowers || showFollowing) && (
              <div style={{ marginTop: 12, padding: '10px 12px', background: '#f6f8fa', border: '1px solid #d0d7de', borderRadius: 6 }}>
                <b style={{ fontSize: 13 }}>{showFollowers ? '粉丝' : '关注'}列表</b>
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(showFollowers ? followers : following).length === 0 && (
                    <span style={{ fontSize: 13, color: '#656d76' }}>暂无</span>
                  )}
                  {(showFollowers ? followers : following).map((f) => (
                    <Link
                      key={f.id}
                      href={`/users/${f.username}`}
                      className="badge"
                      style={{ background: '#fff', border: '1px solid #d0d7de', color: '#0969da', textDecoration: 'none' }}
                    >
                      {f.username}
                      {f.role === 'teacher' ? '（教师）' : f.role === 'admin' ? '（管理员）' : ''}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>

          {visible('heatmap') && (
          <section className="card fade-in" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>近 90 天 AC 热力图</h2>
            {heatmap.length === 0 ? (
              <p style={{ color: '#656d76', fontSize: 13 }}>暂无数据</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'flex', gap: 3, minWidth: 760 }}>
                  {Array.from({ length: Math.ceil(90 / 7) }).map((_, week) => (
                    <div key={week} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                        const cell = heatmap[week * 7 + day];
                        if (!cell) return <span key={day} style={{ width: 11, height: 11 }} />;
                        return (
                          <span
                            key={day}
                            title={`${cell.date} · ${cell.count} 次 AC`}
                            style={{
                              width: 11,
                              height: 11,
                              borderRadius: 2,
                              background: heatColor(cell.count),
                              opacity: cell.count === 0 ? 0.9 : 1
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: '#656d76', marginTop: 8 }}>
                  最多单日 {maxCount} 次 AC
                </div>
              </div>
            )}
          </section>
          )}

          {visible('solved') && (
          <section className="card fade-in" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>已 AC 题目（{user.solved.length}）</h2>
            {user.solved.length === 0 ? (
              <p style={{ color: '#656d76', fontSize: 13 }}>还没有通过的题目</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {user.solved.map((p) => (
                  <a
                    key={p.id}
                    href={`/problems/${p.id}`}
                    className="badge"
                    style={{ background: '#f6f8fa', border: '1px solid #d0d7de', color: '#1f2328', textDecoration: 'none' }}
                  >
                    <DifficultyBadge difficulty={p.difficulty} /> {p.title}
                  </a>
                ))}
              </div>
            )}
          </section>
          )}

          {visible('badges') && (
            <section className="card fade-in" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, marginTop: 0 }}>
                徽章（{badges ? badges.items.filter((b) => b.earned).length : 0} / {badges?.items.length ?? 0}）
              </h2>
              {!badges ? (
                <p style={{ color: '#656d76', fontSize: 13 }}>加载中...</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                  {badges.items.map((b) => (
                    <div key={b.code} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', border: '1px solid #eaeef2', borderRadius: 6, background: b.earned ? '#f6f8fa' : undefined, opacity: b.earned ? 1 : 0.55 }}>
                      <span aria-hidden="true" style={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, background: b.earned ? '#0969da' : '#d8dee4', color: '#fff' }}>
                        {b.earned ? badgeIcon(b.code) : '?'}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: b.earned ? '#0969da' : '#57606a' }}>{b.name}</div>
                        <div style={{ fontSize: 11, color: '#656d76', lineHeight: 1.4 }}>{b.earned ? b.desc : '未达成'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {visible('messages') && (
            <section className="card fade-in">
              <h2 style={{ fontSize: 16, marginTop: 0 }}>留言板（{messages.length}）</h2>
            {me && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  placeholder="写下留言..."
                  maxLength={1000}
                  style={{ flex: 1 }}
                  aria-label="留言内容"
                />
                <button type="button" className="btn" disabled={msgBusy || !msgText.trim()} onClick={() => void postMessage()}>
                  留言
                </button>
              </div>
            )}
            {msgError && <p className="error" style={{ fontSize: 13 }}>{msgError}</p>}
            {messages.length === 0 ? (
              <p style={{ color: '#656d76', fontSize: 13 }}>还没有留言</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {messages.map((m) => (
                  <div key={m.id} style={{ padding: '8px 10px', background: '#f6f8fa', border: '1px solid #eaeef2', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: '#656d76' }}>
                      <Link href={`/users/${m.author_name}`} style={{ color: '#0969da', textDecoration: 'none' }}>{m.author_name}</Link>
                      {' '}· {new Date(m.created_at).toLocaleString()}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}
        </>
      )}
    </main>
  );
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
