import Link from 'next/link';
import './globals.css';

interface HomeModule {
  key: string;
  label: string;
  enabled: boolean;
}

interface DailyProblemItem {
  id: number; title: string; difficulty: string; description: string; tags: string[];
}

interface DailyInfo {
  date: string | null;
  problem: DailyProblemItem | null;
  status: 'pending' | 'finished' | null;
  end_type: 'auto' | 'manual' | null;
  ended_at: string | null;
  result: {
    submissions: number;
    ac_submissions: number;
    ac_users: number;
    pass_rate: number;
    fastest: { username: string; runtime_ms: number } | null;
    leaderboard: Array<{ rank: number; username: string; first_ac_at: string }>;
  } | null;
}

const LANGUAGES = ['Python', 'Java', 'JavaScript', 'Node.js', 'C++', 'C'];

const featureCards = [
  {
    href: '/problems',
    title: '题库',
    desc: '多语言题目，在线提交判题。'
  },
  {
    href: '/submissions',
    title: '提交记录',
    desc: '提交历史与判题详情。'
  },
  {
    href: '/leaderboard',
    title: '排行榜',
    desc: '总榜 / 周榜 / 月榜。'
  },
  {
    href: '/contests',
    title: '比赛',
    desc: '参与限时比赛，争夺排名。'
  }
];

const flowSteps = [
  { index: '01', title: '认证', desc: '注册 / 登录 · JWT 鉴权' },
  { index: '02', title: '提交', desc: '代码入队 · RabbitMQ 异步' },
  { index: '03', title: '判题', desc: '真实执行 · 超时 / 内存限制' },
  { index: '04', title: '排行', desc: 'AC 统计 · Redis 实时榜单' }
];

async function getBasicStats(url: string) {
  const stats = { problems: 0, ok: false, text: '检测中' };
  try {
    const [problemsRes, healthRes] = await Promise.all([
      fetch(`${url}/api/problems?limit=1`, { cache: 'no-store' }),
      fetch(`${url}/health`, { cache: 'no-store' })
    ]);
    if (healthRes.ok) {
      const health = (await healthRes.json()) as { status?: string };
      stats.ok = health.status === 'ok';
    }
    if (problemsRes.ok) {
      const data = (await problemsRes.json()) as { data?: { total?: number } };
      stats.problems = data?.data?.total ?? 0;
    }
    stats.text = stats.ok ? '运行中' : '降级';
  } catch {
    stats.text = '不可达';
  }
  return stats;
}

async function getSiteInfo(url: string) {
  const info = {
    daily: null as DailyInfo | null,
    modules: [] as HomeModule[]
  };
  try {
    const [daily, mods] = await Promise.all([
      fetch(`${url}/api/daily-problem`, { cache: 'no-store' }),
      fetch(`${url}/api/home-modules`, { cache: 'no-store' }).catch(() => null)
    ]);
    if (daily.ok) {
      const data = (await daily.json()) as { data?: DailyInfo | null };
      info.daily = data?.data ?? null;
    }
    if (mods && mods.ok) {
      const data = (await mods.json()) as { data?: { modules?: HomeModule[] } };
      info.modules = data?.data?.modules ?? [];
    }
  } catch {
    // site info is non-critical
  }
  return info;
}

function isEnabled(modules: HomeModule[], key: string): boolean {
  const m = modules.find((x) => x.key === key);
  return m === undefined ? true : m.enabled;
}

export default async function HomePage() {
  const internalGatewayUrl = process.env.GATEWAY_INTERNAL_URL || process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080';
  const [stats, info] = await Promise.all([
    getBasicStats(internalGatewayUrl),
    getSiteInfo(internalGatewayUrl)
  ]);
  const daily = info.daily;

  return (
    <main className="container">
      {isEnabled(info.modules, 'hero') && (
        <>
          <section className="hero">
            <div className="hero-glow" aria-hidden="true" />
            <div className="hero-inner">
              <h1 className="hero-title">PolyCodeHub</h1>
              <p className="hero-sub">全栈多语言在线判题平台</p>
              <p className="hero-desc">账号体系 · 题库 · 真实判题 · 实时排行榜，一条链路闭环。选择你的语言，开始解题。</p>
              <div className="hero-actions">
                <Link className="btn" href="/problems">开始刷题</Link>
                <Link className="btn btn-secondary" href="/register">注册账号</Link>
              </div>
            </div>
          </section>
          {isEnabled(info.modules, 'badges') && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', margin: '-10px 0 18px' }}>
              {LANGUAGES.map((lang) => (
                <span className="tech-badge" key={lang}>{lang}</span>
              ))}
            </div>
          )}
        </>
      )}

      {isEnabled(info.modules, 'stats') && (
        <section className="stat-strip" aria-label="平台统计">
          <div className="stat-chip">
            <span className="stat-value">{stats.problems}</span>
            <span className="stat-label">题目总数</span>
          </div>
          <div className="stat-chip">
            <span className="stat-value">{LANGUAGES.length}</span>
            <span className="stat-label">支持语言</span>
          </div>
          <div className="stat-chip">
            <span className="stat-value">{stats.ok ? 'Up' : 'Down'}</span>
            <span className="stat-label">判题引擎</span>
          </div>
          <div className="stat-chip">
            <span className="stat-value" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className={`pulse-dot${stats.ok ? ' pulse-dot-ok' : ''}`} aria-hidden="true" />
              {stats.text}
            </span>
            <span className="stat-label">网关服务</span>
          </div>
        </section>
      )}

      {isEnabled(info.modules, 'daily') && daily?.problem && (
        <section className="card fade-in" style={{ margin: '0 0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="badge badge-ac">每日一题</span>
            <span style={{ fontSize: 12, color: '#656d76' }}>
              {daily.date ?? ''}
            </span>
            <span
              className="badge"
              style={
                daily.status === 'finished'
                  ? { background: '#dafbe1', color: '#1a7f37' }
                  : { background: '#fff8c5', color: '#7d4e00' }
              }
            >
              {daily.status === 'finished'
                ? `已结束（${daily.end_type === 'manual' ? '提前结束' : '按时结束'}）`
                : '进行中'}
            </span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{daily.problem.title}</span>
            <span className="badge" style={{ background: daily.problem.difficulty === 'EASY' ? '#dafbe1' : daily.problem.difficulty === 'MEDIUM' ? '#fff1e5' : '#ffebe9', color: daily.problem.difficulty === 'EASY' ? '#1a7f37' : daily.problem.difficulty === 'MEDIUM' ? '#9a6700' : '#cf222e' }}>
              {daily.problem.difficulty}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Link className="btn btn-ghost btn-sm" href="/daily">
                历史记录
              </Link>
              {daily.status !== 'finished' && (
                <Link className="btn btn-sm" href={`/problems/${daily.problem.id}`}>
                  立即挑战 →
                </Link>
              )}
            </div>
          </div>
          {daily.status === 'finished' && daily.result && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #eaeef2', fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', color: '#57606a' }}>
                <span>提交 <b>{daily.result.submissions}</b></span>
                <span>AC 提交 <b>{daily.result.ac_submissions}</b></span>
                <span>AC 人数 <b>{daily.result.ac_users}</b></span>
                <span>通过率 <b>{daily.result.pass_rate}%</b></span>
                {daily.result.fastest && (
                  <span>最快 <b>{daily.result.fastest.username}</b>（{daily.result.fastest.runtime_ms} ms）</span>
                )}
              </div>
              {daily.result.leaderboard.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {daily.result.leaderboard.map((r) => (
                    <Link
                      key={r.rank}
                      href={`/users/${encodeURIComponent(r.username)}`}
                      className="badge"
                      style={{ background: '#f6f8fa', border: '1px solid #d0d7de', color: r.rank <= 3 ? '#9a6700' : '#57606a', textDecoration: 'none' }}
                    >
                      #{r.rank} {r.username}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {isEnabled(info.modules, 'features') && (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
            marginBottom: 16
          }}
        >
          {featureCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="card fade-in feature-card"
              style={{ textDecoration: 'none', margin: 0 }}
            >
              <h2 style={{ fontSize: 17, margin: '0 0 6px' }}>{card.title}</h2>
              <p style={{ margin: 0, color: '#656d76', fontSize: 13, lineHeight: 1.6 }}>{card.desc}</p>
            </Link>
          ))}
        </section>
      )}

      {isEnabled(info.modules, 'flow') && (
        <section className="card fade-in" style={{ margin: 0 }}>
          <h2 className="card-title" style={{ marginBottom: 14 }}>一次提交的完整链路</h2>
          <div className="flow-grid">
            {flowSteps.map((step, index) => (
              <div className="flow-step" key={step.index}>
                <span className="flow-index">{step.index}</span>
                <div>
                  <div className="flow-title">{step.title}</div>
                  <div className="flow-desc">{step.desc}</div>
                </div>
                {index < flowSteps.length - 1 && <span className="flow-arrow" aria-hidden="true">→</span>}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                flexShrink: 0,
                ...(stats.ok ? { background: '#1a7f37', boxShadow: '0 0 0 4px #1a7f3722' } : { background: '#cf222e', boxShadow: '0 0 0 4px #cf222e22' })
              }}
            />
            <span style={{ fontSize: 14 }}>
              网关服务 <strong>{stats.text}</strong>
            </span>
          </div>
        </section>
      )}
    </main>
  );
}