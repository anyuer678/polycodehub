import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="container">
      <h1>404</h1>
      <p>页面不存在</p>
      <Link href="/" className="btn">
        返回首页
      </Link>
    </main>
  );
}
