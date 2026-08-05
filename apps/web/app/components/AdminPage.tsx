"use client";

import { ReactNode } from 'react';

type AdminPageProps = {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
};

/**
 * 管理后台页面统一容器。
 * - 不重复 .container（外层 admin/layout.tsx 已提供，避免 padding 双倍）
 * - 统一 h1.page-title 标题
 * - 统一灰色副标题样式
 */
export default function AdminPage({ title, subtitle, children }: AdminPageProps) {
  return (
    <main className="admin-page">
      <h1 className="page-title">{title}</h1>
      {subtitle != null && (
        <p className="admin-subtitle">{subtitle}</p>
      )}
      {children}
    </main>
  );
}
