import './globals.css';
import React from 'react';
import NavBar from './components/NavBar';

export const metadata = {
  title: 'PolyCodeHub',
  description: 'Multi-language full-stack platform skeleton'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <NavBar />
        {children}
      </body>
    </html>
  );
}
