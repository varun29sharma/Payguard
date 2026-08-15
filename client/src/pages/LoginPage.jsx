import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ArrowLeft, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axiosConfig';

const DEMO = { email: 'demo@payguard.io', password: 'payguard-demo' };

export default function LoginPage() {
  const [tab,      setTab]      = useState('login');
  const [form,     setForm]     = useState({ name: '', email: '', password: '', role: 'analyst' });
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const { login } = useAuth();
  const navigate  = useNavigate();

  const handleChange = (e) => { setForm(f => ({ ...f, [e.target.name]: e.target.value })); setError(''); };

  const submit = async (ep, payload) => {
    setLoading(true); setError('');
    try {
      const { data } = await api.post(ep, payload);
      login(data.user, data.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Connection failed');
    } finally { setLoading(false); }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = tab === 'login'
      ? { email: form.email, password: form.password }
      : { name: form.name, email: form.email, password: form.password, role: form.role };
    submit(tab === 'login' ? '/auth/login' : '/auth/register', payload);
  };

  const useDemo = async () => {
    setTab('login');
    setForm(f => ({ ...f, email: DEMO.email, password: DEMO.password }));
    await submit('/auth/login', DEMO);
  };

  return (
    <div className="min-h-screen bg-paper flex">
      {/* Statement panel */}
      <div className="hidden lg:flex w-1/2 flex-col justify-between border-r border-hairline bg-card p-14">
        <Link to="/" className="text-2xl font-black tracking-tight leading-none w-fit">
          PAYGUARD<span className="text-accent">!</span>
        </Link>
        <div>
          <h1 className="text-6xl font-black tracking-tight leading-[1.05] max-w-md">
            Fraud intelligence, in real time.
          </h1>
          <p className="mt-6 max-w-md text-ink-soft leading-relaxed">
            PayGuard monitors payment flows for enumeration attacks, relay
            fraud and account-takeover waves — scoring every transaction
            before it commits.
          </p>
          <div className="mt-10 space-y-2">
            <div className="flex gap-4"><span className="font-mono text-[11px] text-accent">01</span><span className="label">Rule engine + fallback health</span></div>
            <div className="flex gap-4"><span className="font-mono text-[11px] text-accent">02</span><span className="label">Identity-graph entity blocking</span></div>
            <div className="flex gap-4"><span className="font-mono text-[11px] text-accent">03</span><span className="label">Campaign detection &amp; audit trail</span></div>
          </div>
        </div>
        <div className="label">© {new Date().getFullYear()} PayGuard</div>
      </div>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-10">
            <div className="lg:hidden text-2xl font-black tracking-tight">
              PAYGUARD<span className="text-accent">!</span>
            </div>
            <Link to="/" className="link-btn inline-flex items-center gap-1.5 ml-auto">
              <ArrowLeft size={13} /> Home
            </Link>
          </div>

          <div className="flex gap-8 mb-10 border-b border-hairline">
            {['login', 'register'].map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(''); }}
                className={`pb-3 font-semibold text-sm uppercase tracking-wide transition-colors ${
                  tab === t ? 'text-ink border-b-2 border-ink -mb-px' : 'text-muted hover:text-ink'
                }`}
              >
                {t === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          {/* Demo access */}
          {tab === 'login' && (
            <div className="border border-accent/40 bg-accent/5 p-4 mb-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink mb-1 flex items-center gap-2">
                    <Zap size={12} className="text-accent" /> Demo access
                  </div>
                  <div className="font-mono text-xs text-ink-soft">
                    demo@payguard.io &nbsp;/&nbsp; payguard-demo
                  </div>
                </div>
                <button onClick={useDemo} disabled={loading} className="btn btn-accent btn-sm flex-shrink-0">
                  {loading ? 'Signing in…' : 'Use demo'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="border border-accent/40 bg-accent/5 p-3 mb-8 flex items-start gap-3">
              <span className="text-accent font-bold leading-none mt-0.5">!</span>
              <div className="text-xs text-ink-soft font-mono uppercase leading-relaxed">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-7">
            {tab === 'register' && (
              <div>
                <label className="label block mb-1">Name</label>
                <input name="name" value={form.name} onChange={handleChange} required className="input" placeholder="Analyst name" />
              </div>
            )}
            <div>
              <label className="label block mb-1">Email</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} required className="input" placeholder="you@company.com" />
            </div>
            <div>
              <label className="label block mb-1">Password</label>
              <div className="relative">
                <input name="password" type={showPwd ? 'text' : 'password'} value={form.password} onChange={handleChange} required className="input pr-10" placeholder="••••••••" />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-0 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
                  {showPwd ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            {tab === 'register' && (
              <div>
                <label className="label block mb-1">Role</label>
                <select name="role" value={form.role} onChange={handleChange} className="input uppercase">
                  <option value="analyst">Analyst</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn w-full py-4 text-sm mt-4">
              {loading ? 'Signing in…' : tab === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
