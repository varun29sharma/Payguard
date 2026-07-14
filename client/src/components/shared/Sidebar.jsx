import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LogOut, SquareTerminal, ShieldAlert, Cpu, Network, LockKeyhole } from 'lucide-react';

const NAV = [
  { to: '/dashboard',    icon: SquareTerminal, label: 'HUB / HQ',       sub: 'Operations Core' },
  { to: '/intelligence', icon: Network,        label: 'INTEL ROOM',     sub: 'Threat Campaigns' },
  { to: '/alerts',       icon: ShieldAlert,    label: 'REVIEW DEPT',    sub: 'Active Alerts' },
  { to: '/simulator',    icon: Cpu,            label: 'WORKBENCH',      sub: 'Simulations' },
  { to: '/blocklist',    icon: LockKeyhole,    label: 'BLOCK REGISTRY', sub: 'Locked Entities' },
];

export default function Sidebar({ connected }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <aside className="w-64 flex-shrink-0 bg-bg-secondary border-r-2 border-border-mid flex flex-col h-screen sticky top-0 font-pixel">
      {/* Logo */}
      <div className="px-5 py-6 border-b-2 border-border-mid bg-bg-card">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 bg-brand border-2 border-brand flex items-center justify-center pixel-box-brand">
            <SquareTerminal size={18} className="text-bg-card" />
          </div>
          <span className="font-vt text-3xl tracking-widest text-brand text-shadow-pixel">PAYGUARD</span>
        </div>
        <div className="text-xs text-text-muted tracking-widest uppercase ml-11">
          PRECINCT COMMS
        </div>
      </div>

      {/* Live indicator */}
      <div className="px-5 py-3 border-b-2 border-border-mid bg-bg-primary">
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 border border-bg-primary ${connected ? 'bg-brand animate-pulse-fast' : 'bg-red-500'}`} />
          <span className={`text-sm tracking-wide ${connected ? 'text-brand' : 'text-red-400'}`}>
            {connected ? 'LINK ESTABLISHED' : 'LINK LOST...'}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        <div className="text-xs text-text-sec uppercase tracking-widest px-2 mb-3 border-b border-border-hi pb-1 inline-block">Directory</div>
        {NAV.map(({ to, icon: Icon, label, sub }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3 mb-2 transition-all group border-2
               ${isActive
                 ? 'bg-brand text-bg-primary border-brand box-shadow-none translate-y-[1px] translate-x-[1px]'
                 : 'bg-bg-card text-text-pri border-border-hi shadow-[2px_2px_0_0_#000] hover:bg-border-dim'}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} className={isActive ? 'text-bg-primary' : 'text-text-sec group-hover:text-text-pri'} />
                <div className="flex-1 min-w-0">
                  <div className={`text-lg leading-none truncate ${isActive ? 'font-bold' : ''}`}>{label}</div>
                  <div className={`text-[10px] font-mono mt-1 truncate ${isActive ? 'text-bg-secondary' : 'text-text-muted'}`}>{sub}</div>
                </div>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div className="px-4 py-4 border-t-2 border-border-mid bg-bg-card">
        <div className="pixel-box p-2 mb-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-border-hi border border-border-mid flex items-center justify-center text-text-pri text-lg">
            {user?.name?.[0] || 'A'}
          </div>
          <div className="flex-1 min-w-0 font-vt">
            <div className="text-xl text-text-pri truncate leading-none mb-1">{user?.name || 'ANALYST'}</div>
            <div className="text-sm text-brand tracking-widest uppercase leading-none">{user?.role || 'operator'}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-red-400 bg-bg-secondary border-2 border-red-500/30 hover:bg-red-500/10 hover:border-red-500 transition-all font-pixel text-sm uppercase shadow-[2px_2px_0_0_rgba(0,0,0,0.8)] active:translate-y-[2px] active:translate-x-[2px] active:shadow-none"
        >
          <LogOut size={14} />
          Disengage
        </button>
      </div>
    </aside>
  );
}
