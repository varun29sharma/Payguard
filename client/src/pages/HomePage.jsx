import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { Moon, Sun } from 'lucide-react';

const WORK = [
  {
    num: '01',
    title: 'Real-time scoring engine',
    quote: '“Every transaction gets a decision.”',
    text: 'Six fraud rules — velocity, enumeration, amount threshold, new device, night owl, geographic anomaly — evaluate each transaction before it commits, in a dedicated Spring Boot service.',
  },
  {
    num: '02',
    title: 'Identity-graph blocking',
    quote: '“One block stops the whole ring.”',
    text: 'Blocking a user traces every device, IP, card fingerprint and email that ever touched the same transactions, and locks them all — a fraud ring can’t just switch accounts.',
  },
  {
    num: '03',
    title: 'Campaign intelligence',
    quote: '“The pattern, not the single event.”',
    text: 'Enumeration waves, merchant scam networks, NFC relay fraud and account-takeover bursts are detected automatically and tracked as campaigns with severity and exposure.',
  },
  {
    num: '04',
    title: 'Analyst workbench',
    quote: '“Triage, escalate, act.”',
    text: 'A live simulator generates synthetic fraud scenarios, and every alert carries its rule history, user timeline and one-click block actions — built for the person at the desk.',
  },
  {
    num: '05',
    title: 'Immutable audit trail',
    quote: '“Nothing is ever deleted.”',
    text: 'Every analyst action is written once to an audit log, and every blocked entity, rejected transaction and resolved alert is archived permanently for regulators and review.',
  },
  {
    num: '06',
    title: 'Live operations',
    quote: '“The room knows before you do.”',
    text: 'Socket.IO pushes every new transaction, alert and campaign to the dashboard the moment it happens — with the scoring engine’s health visible at all times.',
  },
];

const STACK = [
  { title: 'Backend',  detail: 'Node.js + Express, typed errors, event bus' },
  { title: 'Scoring',  detail: 'Java + Spring Boot, six composable rules' },
  { title: 'Data',     detail: 'MongoDB with identity-graph traversal' },
  { title: 'Interface', detail: 'React + Tailwind, real-time via Socket.IO' },
];

export default function HomePage() {
  const { isDark, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Top bar */}
      <header className="sticky top-0 z-20 bg-paper/90 backdrop-blur border-b border-hairline">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-black tracking-tight">
            PAYGUARD<span className="text-accent">!</span>
          </Link>
          <div className="flex items-center gap-3">
            <button onClick={toggle} className="btn btn-ghost btn-sm" title="Toggle theme">
              {isDark ? <Sun size={13} /> : <Moon size={13} />}
              {isDark ? 'Light' : 'Dark'}
            </button>
            <Link to="/login" className="btn btn-sm">
              Sign in <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-hairline">
        <div className="max-w-6xl mx-auto px-6 pt-24 pb-20">
          <div className="label mb-6">Payment fraud intelligence platform</div>
          <h1 className="text-6xl md:text-8xl font-black tracking-tight leading-[0.95]">
            Detected.<br />Reviewed.<br />Blocked.
          </h1>
          <p className="mt-8 max-w-2xl text-lg text-ink-soft leading-relaxed">
            PayGuard scores every transaction in real time — catching
            enumeration attacks, relay fraud and account-takeover waves before
            they commit. Built for UPI and payment networks.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link to="/dashboard" className="btn px-8 py-4 text-sm">
              Open the dashboard <ArrowRight size={14} />
            </Link>
            <a href="#work" className="btn btn-ghost px-8 py-4 text-sm">
              See how it works
            </a>
          </div>
          <div className="mt-16 flex flex-wrap gap-x-12 gap-y-3 font-mono text-xs uppercase tracking-wider text-muted">
            <span>6 fraud rules</span>
            <span>9 identity fields</span>
            <span>5 campaign types</span>
            <span>1 immutable audit trail</span>
          </div>
        </div>
      </section>

      {/* 01 — Principle */}
      <section className="border-b border-hairline">
        <div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-[200px_1fr] gap-10">
          <div className="label">01 — The principle</div>
          <div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight leading-tight max-w-xl">
              Every transaction gets a decision. Nothing gets deleted.
            </h2>
            <p className="mt-6 max-w-2xl text-ink-soft leading-relaxed">
              Fraud is a race: the decision must land before the money moves,
              and the record of what happened must outlive the incident. That
              is the whole design. Scores come from a real engine — and if the
              engine is ever unreachable, the system says so, openly, instead
              of pretending everything is fine.
            </p>
          </div>
        </div>
      </section>

      {/* 02 — The work */}
      <section id="work" className="border-b border-hairline">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="label mb-10">02 — The work</div>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight leading-tight max-w-2xl mb-16">
            Six chosen capabilities, all custom-built.
          </h2>
          <div className="grid md:grid-cols-2 gap-x-12 gap-y-14">
            {WORK.map(w => (
              <div key={w.num} className="border-t-2 border-ink pt-6">
                <div className="flex items-baseline gap-4 mb-4">
                  <span className="font-mono text-sm text-accent">{w.num}</span>
                  <h3 className="text-2xl font-bold tracking-tight">{w.title}</h3>
                </div>
                <div className="font-mono text-sm text-muted mb-3">{w.quote}</div>
                <p className="text-ink-soft leading-relaxed text-[15px]">{w.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 03 — The stack */}
      <section className="border-b border-hairline">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="label mb-10">03 — The stack</div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-8">
            {STACK.map(s => (
              <div key={s.title} className="border-t-2 border-ink pt-5">
                <div className="text-lg font-bold tracking-tight mb-2">{s.title}</div>
                <div className="text-sm text-ink-soft leading-relaxed">{s.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 04 — Who */}
      <section className="border-b border-hairline">
        <div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-[200px_1fr] gap-10">
          <div className="label">04 — Who</div>
          <div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight leading-tight max-w-xl">
              Built for fraud teams that need to act fast and prove everything.
            </h2>
            <p className="mt-6 max-w-2xl text-ink-soft leading-relaxed">
              The analyst at the desk sees one screen: live transactions,
              campaigns, and a triage queue. The compliance officer sees one
              trail: every decision, audited and permanent. The engineer sees
              one honest system: when the engine falls back, it says so.
            </p>
          </div>
        </div>
      </section>

      {/* 05 — Talk / demo */}
      <section>
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="label mb-10">05 — Demo access</div>
          <div className="flex flex-col lg:flex-row lg:items-end gap-10 justify-between">
            <div>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight leading-tight max-w-xl">
                A project that deserves care? Open the console.
              </h2>
              <p className="mt-6 max-w-xl text-ink-soft leading-relaxed">
                One demo account, already seeded. Fire up the simulator, block
                a device, watch a campaign form — then check the audit trail.
              </p>
            </div>
            <div className="w-full max-w-sm border border-hairline bg-card p-6">
              <div className="label mb-4">Demo account</div>
              <div className="font-mono text-sm space-y-2 mb-6">
                <div className="flex justify-between gap-4"><span className="text-muted">email</span><span className="font-semibold">demo@payguard.io</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted">password</span><span className="font-semibold">payguard-demo</span></div>
              </div>
              <Link to="/login" className="btn btn-accent w-full justify-center">
                Open sign-in <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-hairline">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm font-black tracking-tight">
            PAYGUARD<span className="text-accent">!</span>
          </div>
          <div className="font-mono text-xs uppercase tracking-wider text-muted">
            © {new Date().getFullYear()} PayGuard · Method · Legal notice · Privacy
          </div>
        </div>
      </footer>
    </div>
  );
}
