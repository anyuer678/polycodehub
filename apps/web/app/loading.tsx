import { Spinner } from './components/ui';

export default function Loading() {
  return (
    <main className="container">
      <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: '48px 16px' }}>
        <Spinner label="加载中..." />
      </div>
    </main>
  );
}
