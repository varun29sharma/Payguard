import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useEngineHealth from '../../hooks/useEngineHealth';
import { LogOut, Moon, Sun } from 'lucide-react';

const NAV = [
  { to: '/',             label: 'Home',       sub: 'About PayGuard' },
  { to: '/dashboard',    label: 'Operations', sub: 'Live overview' },
  { to: '/intelligence', label: 'Intel',      sub: 'Threat campaigns' },
  { to: '/alerts',       label: 'Alerts',     sub: 'Triage queue' },
  { to: '/simulator',    label: 'Simulator',  sub: 'Test scenarios' },
  { to: '/blocklist',    label: 'Blocklist',  sub: 'Locked entities' },
  { to: '/rules',        label: 'Rules',      sub: 'Engine configuration' },
  { to: '/backtest',     label: 'Backtest',   sub: 'Replay rule changes' },
  { to: '/disputes',     label: 'Disputes',   sub: 'Confirmed fraud loop' },
  { to: '/mules',        label: 'Mules',      sub: 'Laundering rings' },
  { to: '/merchants',     label: 'Merchants',  sub: 'Risk profiles' },
  { to: '/graph',          label: 'Graph',       sub: 'Identity explorer' },
];

export default function Sidebar({ connected }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const engine = useEngineHealth();
  const { isDark, toggle } = useTheme();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <aside className="w-64 flex-shrink-0 bg-card border-r border-hairline flex flex-col h-screen sticky top-0">
      {/* Wordmark */}
      <div className="px-6 py-8 border-b border-hairline">
        <div className="text-2xl font-black tracking-tight leading-none">
          PAYGUARD<span className="text-accent">!</span>
        </div>
        <div className="label mt-2">Fraud Intelligence</div>
      </div>

      {/* Live + engine status */}
      <div className="px-6 py-4 border-b border-hairline space-y-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-ink' : 'bg-accent animate-blink'}`} />
          <span className="label">{connected ? 'Live — connected' : 'Live — offline'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            engine.mode === 'engine'   ? 'bg-ink'
            : engine.mode === 'fallback' ? 'bg-accent animate-blink'
            : 'bg-muted'
          }`} />
          <span className="label">
            {engine.mode === 'engine'   ? 'Engine — online'
             : engine.mode === 'fallback' ? 'Engine — fallback'
             : 'Engine — checking'}
          </span>
        </div>
        {engine.mode === 'fallback' && (
          <div className="text-[10px] font-mono text-accent uppercase tracking-wider leading-tight">
            All transactions scored clear
          </div>
        )}
        {engine.fallbackCount > 0 && (
          <div className="text-[10px] font-mono text-muted uppercase tracking-wider leading-tight">
            Fallbacks: {engine.fallbackCount}{engine.lastFallbackAt ? ` @ ${new Date(engine.lastFallbackAt).toLocaleTimeString()}` : ''}
          </div>
        )}
      </div>

      {/* Index */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        {NAV.map(({ to, label, sub }, i) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-baseline gap-4 px-3 py-3 transition-colors group border-l-2 ${
                isActive ? 'border-accent bg-paper' : 'border-transparent hover:border-hairline-strong'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`font-mono text-[11px] ${isActive ? 'text-accent' : 'text-muted group-hover:text-ink'}`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-[15px] font-semibold uppercase tracking-wide leading-none ${isActive ? 'text-ink' : 'text-ink-soft group-hover:text-ink'}`}>
                    {label}
                  </span>
                  <span className="block text-[11px] text-muted mt-1 font-mono">{sub}</span>
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="px-6 py-5 border-t border-hairline space-y-2">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 bg-ink text-paper flex items-center justify-center font-bold text-sm">
            {user?.name?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate leading-none mb-1">{user?.name || 'Analyst'}</div>
            <div className="label">{user?.role || 'operator'}</div>
          </div>
        </div>
        <button onClick={toggle} className="btn btn-ghost btn-sm w-full">
          {isDark ? <Sun size={13} /> : <Moon size={13} />}
          {isDark ? 'Light theme' : 'Dark theme'}
        </button>
        <button onClick={handleLogout} className="btn btn-ghost btn-sm w-full">
          <LogOut size={13} />
          Disengage
        </button>
      </div>
    </aside>
  );
}
