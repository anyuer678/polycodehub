"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../hooks/useAuth';
import AuthGate from '../components/AuthGate';

const STAFF_TABS = [
  { href: '/admin/problems', label: '题目管理', adminOnly: false },
  { href: '/admin/test-cases', label: '测试用例', adminOnly: false },
  { href: '/admin/daily-problem', label: '每日一题', adminOnly: false },
  { href: '/admin/solutions', label: '题解审核', adminOnly: false },
  { href: '/admin/contests', label: '比赛管理', adminOnly: false },
  { href: '/admin/users', label: '用户管理', adminOnly: true },
  { href: '/admin/submissions', label: '提交记录', adminOnly: true },
  { href: '/admin/announcements', label: '公告', adminOnly: true },
  { href: '/admin/notifications', label: '站内信', adminOnly: true },
  { href: '/admin/home', label: '首页设置', adminOnly: true },
  { href: '/admin/audit', label: '审计日志', adminOnly: true },
  { href: '/admin/stats', label: '数据总览', adminOnly: true }
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAdmin, isStaff } = useAuth();

  if (!isStaff) {
    return (
      <div className="container">
        <AuthGate staff>
          <div />
        </AuthGate>
      </div>
    );
  }

  const tabs = STAFF_TABS.filter((tab) => isAdmin || !tab.adminOnly);

  return (
    <div className="container">
      <nav
        aria-label="管理后台导航"
        style={{
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
          marginBottom: 16,
          padding: 6,
          background: '#f6f8fa',
          border: '1px solid #d0d7de',
          borderRadius: 8
        }}
      >
        {tabs.map((tab) => {
          const active = pathname?.startsWith(tab.href) ?? false;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="btn btn-sm"
              style={
                active
                  ? { background: '#0969da', color: '#fff', borderColor: '#0969da' }
                  : { background: 'transparent', borderColor: 'transparent', color: '#57606a' }
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
