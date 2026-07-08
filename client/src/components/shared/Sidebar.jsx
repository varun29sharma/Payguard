import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard, ShieldAlert, Activity, Zap,
  LogOut, Shield, Lock, ChevronRight
} from 'lucide-react';

const NAV = [
  { to: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard',        sub: 'Live overview' },
  { to: '/intelligence', icon: Zap,             label: 'Threat Intel',     sub: 'Campaign detection' },
  { to: '/alerts',       icon: ShieldAlert,     label: 'Alert Workbench',  sub: 'Analyst actions' },
  { to: '/simulator',    icon: Activity,        label: 'Simulator',        sub: 'Test & demo' },
  { to: '/blocklist',    icon: Lock,            label: 'Block List',       sub: 'Blocked entities' },
];

export default function Sidebar({ connected }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <aside className="w-60 flex-shrink-0 bg-bg-secondary border-r border-border-dim flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border-dim">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-7 h-7 bg-brand rounded-lg flex items-center justify-center">
            <Shield size={14} className="text-black" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-lg tracking-tight text-gradient">PayGuard</span>
        </div>
        <div className="text-[10px] text-text-muted tracking-widest uppercase ml-9">
          Fraud Intelligence Platform
        </div>
      </div>

      {/* Live indicator */}
      <div className="px-5 py-3 border-b border-border-dim">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
          <span className={`text-xs font-medium ${connected ? 'text-green-400' : 'text-red-400'}`}>
            {connected ? 'Live feed active' : 'Reconnecting...'}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        <div className="text-[10px] text-text-muted uppercase tracking-widest px-2 mb-2">Operations</div>
        {NAV.map(({ to, icon: Icon, label, sub }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 transition-all group
               ${isActive
                 ? 'bg-brand/10 border border-brand/20 text-brand'
                 : 'text-text-sec hover:text-text-pri hover:bg-bg-card'}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={16} className={isActive ? 'text-brand' : 'text-text-muted group-hover:text-text-sec'} />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium truncate ${isActive ? 'text-brand' : ''}`}>{label}</div>
                  <div className="text-[10px] text-text-muted truncate">{sub}</div>
                </div>
                {isActive && <ChevronRight size={12} className="text-brand" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div className="px-3 py-4 border-t border-border-dim">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-bg-card border border-border-dim mb-2">
          <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center text-brand text-xs font-bold uppercase">
            {user?.name?.[0] || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-pri truncate">{user?.name || 'Analyst'}</div>
            <div className="text-[10px] text-text-muted capitalize">{user?.role || 'analyst'}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/5 transition-all text-sm"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
