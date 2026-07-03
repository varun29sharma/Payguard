import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useSocket } from '../hooks/useSocket'
import { User } from 'lucide-react'

export default function Sidebar(){
  const socket = useSocket();
  const [connected, setConnected] = useState(false);
  const navigate = useNavigate();

  useEffect(()=>{
    if(!socket) return;
    const onConnect = ()=> setConnected(true);
    const onDisconnect = ()=> setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setConnected(socket.connected);
    return ()=>{
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    }
  },[socket]);

  const userRaw = localStorage.getItem('pg_user');
  const user = userRaw ? JSON.parse(userRaw) : { name: 'Guest', role: 'analyst' };

  function handleLogout(){
    localStorage.removeItem('pg_token');
    localStorage.removeItem('pg_user');
    navigate('/login');
  }

  return (
    <aside className="w-72 min-h-screen p-6 flex flex-col justify-between bg-[var(--bg-secondary)] border-r border-[#1e1e2e]">
      <div>
        <div className="mb-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-brand flex items-center justify-center text-black font-bold">PG</div>
          <div>
            <div className="text-brand font-semibold">PayGuard</div>
            <div className="text-xs text-[var(--text-secondary)]">Real-time fraud intelligence</div>
          </div>
        </div>

        <nav className="flex flex-col space-y-2">
          <NavLink to="/dashboard" className={({isActive}) => `px-3 py-2 rounded-lg flex items-center gap-3 ${isActive ? 'border-l-4 border-brand bg-[var(--bg-card)]' : 'hover:bg-[var(--bg-card)]'}`}>
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/alerts" className={({isActive}) => `px-3 py-2 rounded-lg flex items-center gap-3 ${isActive ? 'border-l-4 border-brand bg-[var(--bg-card)]' : 'hover:bg-[var(--bg-card)]'}`}>
            <span>Alerts</span>
          </NavLink>
          <NavLink to="/simulator" className={({isActive}) => `px-3 py-2 rounded-lg flex items-center gap-3 ${isActive ? 'border-l-4 border-brand bg-[var(--bg-card)]' : 'hover:bg-[var(--bg-card)]'}`}>
            <span>Simulator</span>
          </NavLink>
        </nav>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[var(--bg-card)] rounded-md flex items-center justify-center text-[var(--text-secondary)]"><User size={18} /></div>
            <div>
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-xs text-[var(--text-secondary)]">{user.role}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`}></span>
              <span className="text-xs text-[var(--text-secondary)]">{connected ? 'Live' : 'Disconnected'}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={handleLogout} className="w-full border border-[#1e1e2e] text-[var(--text-secondary)] rounded-lg py-2 hover:border-brand hover:text-brand">Logout</button>
        </div>
      </div>
    </aside>
  )
}
