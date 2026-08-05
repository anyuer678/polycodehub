"use client";

import Link from 'next/link';
import { useAuth } from '../hooks/useAuth';

export default function AuthGate({
  children,
  admin = false,
  staff = false
}: {
  children: React.ReactNode;
  admin?: boolean;
  staff?: boolean;
}) {
  const { isLoggedIn, isAdmin, isStaff, verifying } = useAuth();

  // 挂载后正在向网关确认 Cookie 会话：避免把"未登录"占位闪现给已登录用户
  if (verifying) {
    return (
      <main className="container">
        <div className="card fade-in" style={{ maxWidth: 460, margin: '40px auto', padding: 28, textAlign: 'center' }}>
          <p style={{ color: '#656d76', margin: 0 }}>正在确认登录状态…</p>
        </div>
      </main>
    );
  }

  if (admin || staff) {
    const allowed = staff ? isStaff : isAdmin;
    if (isLoggedIn && allowed) return <>{children}</>;
    return (
      <main className="container">
        <div className="card fade-in" style={{ maxWidth: 460, margin: '40px auto', padding: 28, textAlign: 'center' }}>
          <h1 className="page-title" style={{ margin: '0 0 10px' }}>{staff ? '教师页面' : '管理员页面'}</h1>
          <p style={{ color: '#656d76', margin: '0 0 18px' }}>
            {isLoggedIn ? (staff ? '当前账号没有教师或管理员权限' : '当前账号没有管理员权限') : '请先登录账号'}
          </p>
          {isLoggedIn ? (
            <Link className="btn" href="/">返回首页</Link>
          ) : (
            <>
              <Link className="btn" href="/login">去登录</Link>
              <Link className="btn btn-ghost" href="/" style={{ marginLeft: 8 }}>返回首页</Link>
            </>
          )}
        </div>
      </main>
    );
  }

  if (isLoggedIn) return <>{children}</>;

  return (
    <main className="container">
      <div className="card fade-in" style={{ maxWidth: 460, margin: '40px auto', padding: 28, textAlign: 'center' }}>
        <h1 className="page-title" style={{ margin: '0 0 10px' }}>需要登录</h1>
        <p style={{ color: '#656d76', margin: '0 0 18px' }}>登录后即可查看你的提交记录与个人数据</p>
        <Link className="btn" href="/login">去登录</Link>
        <Link className="btn btn-ghost" href="/register" style={{ marginLeft: 8 }}>注册账号</Link>
      </div>
    </main>
  );
}
