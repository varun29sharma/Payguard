import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SquareTerminal, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axiosConfig';
import bgTile from '../assets/pixel/bg_tile.png';

export default function LoginPage() {
  const [tab,      setTab]      = useState('login');
  const [form,     setForm]     = useState({ name: '', email: '', password: '', role: 'analyst' });
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const { login } = useAuth();
  const navigate  = useNavigate();

  const handleChange = (e) => { setForm(f => ({ ...f, [e.target.name]: e.target.value })); setError(''); };

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const ep = tab === 'login' ? '/auth/login' : '/auth/register';
      const payload = tab === 'login' ? { email: form.email, password: form.password } : form;
      const { data } = await api.post(ep, payload);
      login(data.user, data.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'SYS_ERR: CONN_REFUSED');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex relative overflow-hidden" style={{ backgroundImage: `url(${bgTile})`, backgroundRepeat: 'repeat', backgroundSize: '128px 128px', backgroundBlendMode: 'multiply' }}>
      <div className="crt-overlay"></div>
      
      {/* Visual left half */}
      <div className="hidden lg:flex w-1/2 flex-col items-center justify-center relative z-10 border-r-4 border-border-mid bg-bg-primary/80">
        <div className="pixel-box p-8 border-brand bg-bg-card max-w-md relative">
          <div className="absolute top-0 left-0 bg-brand text-bg-primary text-xs font-pixel px-2 tracking-widest translate-y-[-50%] translate-x-4">SECURE_TERM_01</div>
          <SquareTerminal size={64} className="text-brand mb-6" />
          <h1 className="text-6xl font-vt text-brand tracking-widest text-shadow-pixel mb-4 leading-none">PAYGUARD</h1>
          <div className="h-1 w-full bg-brand mb-6"></div>
          <p className="font-mono text-sm text-text-pri leading-relaxed uppercase mb-6">
            Establishing secure uplink to precinct network.<br/><br/>
            Real-time fraud intelligence online. PERC-aligned campaign detection active.
          </p>
          <div className="flex gap-2">
            <span className="w-3 h-3 bg-brand animate-pulse-fast border border-bg-primary"></span>
            <span className="w-3 h-3 bg-amber-500 animate-pulse-fast border border-bg-primary" style={{ animationDelay: '0.2s' }}></span>
            <span className="w-3 h-3 bg-red-500 animate-pulse-fast border border-bg-primary" style={{ animationDelay: '0.4s' }}></span>
          </div>
        </div>
      </div>

      {/* Form right half */}
      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="pixel-box border-border-hi w-full max-w-md p-8 bg-bg-secondary">
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <SquareTerminal size={32} className="text-brand" />
            <h1 className="text-4xl font-vt text-brand tracking-widest text-shadow-pixel">PAYGUARD</h1>
          </div>

          <div className="flex mb-8 border-b-2 border-border-mid">
            {['login', 'register'].map(t => (
              <button key={t} onClick={() => { setTab(t); setError(''); }} className={`flex-1 py-3 font-pixel text-sm uppercase tracking-widest transition-colors ${tab === t ? 'bg-brand text-bg-primary shadow-[inset_0_-4px_0_0_rgba(0,0,0,0.2)]' : 'text-text-sec hover:bg-border-dim'}`}>
                {t === 'login' ? 'AUTH' : 'NEW_OP'}
              </button>
            ))}
          </div>

          {error && (
            <div className="border-2 border-red-500 bg-red-500/10 p-3 mb-6 flex items-start gap-3">
              <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div className="font-mono text-xs text-red-400 uppercase leading-relaxed">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {tab === 'register' && (
              <div>
                <label className="block font-pixel text-xs text-text-sec mb-2 tracking-widest uppercase">CALLSIGN</label>
                <input name="name" value={form.name} onChange={handleChange} required className="w-full bg-bg-primary border-2 border-border-hi p-3 font-mono text-sm text-text-pri focus:border-brand outline-none uppercase" placeholder="OP_NAME" />
              </div>
            )}
            <div>
              <label className="block font-pixel text-xs text-text-sec mb-2 tracking-widest uppercase">UPLINK_ID [EMAIL]</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} required className="w-full bg-bg-primary border-2 border-border-hi p-3 font-mono text-sm text-text-pri focus:border-brand outline-none" placeholder="OP@PAYGUARD.SYS" />
            </div>
            <div>
              <label className="block font-pixel text-xs text-text-sec mb-2 tracking-widest uppercase">ACCESS_CODE</label>
              <div className="relative">
                <input name="password" type={showPwd ? 'text' : 'password'} value={form.password} onChange={handleChange} required className="w-full bg-bg-primary border-2 border-border-hi p-3 pr-12 font-mono text-sm text-text-pri focus:border-brand outline-none" placeholder="••••••••" />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-pri">
                  {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            {tab === 'register' && (
              <div>
                <label className="block font-pixel text-xs text-text-sec mb-2 tracking-widest uppercase">CLEARANCE</label>
                <select name="role" value={form.role} onChange={handleChange} className="w-full bg-bg-primary border-2 border-border-hi p-3 font-mono text-sm text-text-pri focus:border-brand outline-none uppercase">
                  <option value="analyst">ANALYST</option>
                  <option value="admin">COMMAND</option>
                </select>
              </div>
            )}

            <button type="submit" disabled={loading} className="pixel-btn pixel-btn-brand w-full py-4 text-base tracking-widest mt-4">
              {loading ? 'PROCESSING...' : tab === 'login' ? 'ENGAGE' : 'INITIALIZE'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
