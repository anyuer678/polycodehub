"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiGet } from '../lib/api';

export default function NavBar() {
  const pathname = usePathname();
  const { user, isStaff, logout } = useAuth();
  const [unread, setUnread] = useState(0);

  // 登录用户轮询未读通知数（30s），用于导航栏小红点
  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    function fetchUnread() {
      apiGet<{ unread: number }>('/api/notifications/unread-count')
        .then((r) => {
          if (!cancelled) setUnread(r.data.unread);
        })
        .catch(() => undefined);
    }
    fetchUnread();
    const timer = setInterval(fetchUnread, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname?.startsWith(href) || false;
  }

  const navItems = [
    { href: '/', label: '首页' },
    { href: '/problems', label: '题库' },
    { href: '/contests', label: '比赛' },
    { href: '/submissions', label: '提交' },
    { href: '/leaderboard', label: '排行榜' },
    ...(isStaff ? [{ href: '/admin/problems', label: '管理后台' }] : [])
  ];

  async function handleLogout() {
    // 先等服务端清除 Cookie 完成再跳转，避免导航中断请求导致 httpOnly Cookie 残留（幽灵登录）
    await logout();
    window.location.href = '/login';
  }

  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">P</span>
          PolyCodeHub
        </div>
        <nav className="nav-links" aria-label="主导航">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(item.href) ? 'nav-link active' : 'nav-link'}
              aria-current={isActive(item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="user-box">
          {user ? (
            <>
              <Link className="username" title={user.username} href={`/users/${encodeURIComponent(user.username)}`}>
                {user.username}
                {unread > 0 && (
                  <span
                    aria-label={`${unread} 条未读通知`}
                    style={{
                      display: 'inline-block',
                      minWidth: 16,
                      height: 16,
                      padding: '0 4px',
                      marginLeft: 6,
                      borderRadius: 8,
                      background: '#cf222e',
                      color: '#fff',
                      fontSize: 11,
                      lineHeight: '16px',
                      textAlign: 'center',
                      verticalAlign: 'middle',
                      fontWeight: 600
                    }}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
              <Link className="btn btn-ghost btn-sm" href="/profile" title="个人中心（通知/收藏/提交记录）">个人中心</Link>
              <Link className="btn btn-ghost btn-sm" href="/settings" title="设置">设置</Link>
              <button className="btn btn-ghost" onClick={handleLogout} type="button">
                退出
              </button>
            </>
          ) : (
            <>
              <Link className="btn btn-ghost" href="/register">注册</Link>
              <Link className="btn" href="/login">登录</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}