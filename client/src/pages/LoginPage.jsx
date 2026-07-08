import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axiosConfig';

export default function LoginPage() {
  const [tab,      setTab]      = useState('login');
  const [form,     setForm]     = useState({ name: '', email: '', password: '', role: 'analyst' });
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const { login } = useAuth();
  const navigate  = useNavigate();

  const handleChange = (e) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const endpoint = tab === 'login' ? '/auth/login' : '/auth/register';
      const payload  = tab === 'login'
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, password: form.password, role: form.role };

      const { data } = await api.post(endpoint, payload);
      login(data.user, data.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Check if your server is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex w-1/2 bg-bg-secondary border-r border-border-dim flex-col justify-between p-12 relative overflow-hidden">
        {/* Background grid */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(#00d4b8 1px,transparent 1px),linear-gradient(to right,#00d4b8 1px,transparent 1px)', backgroundSize: '40px 40px' }} />

        {/* Glow orb */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-brand/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center">
              <Shield size={20} className="text-black" strokeWidth={2.5} />
            </div>
            <span className="text-xl font-bold text-gradient">PayGuard</span>
          </div>
          <h1 className="text-4xl font-bold text-text-pri leading-tight mb-4">
            Real-time fraud<br />
            <span className="text-gradient">intelligence</span><br />
            for UPI networks.
          </h1>
          <p className="text-text-sec text-lg leading-relaxed max-w-sm">
            Detect enumeration attacks, relay fraud, and account takeover campaigns before they drain accounts.
          </p>
        </div>

        {/* Stat pills */}
        <div className="relative flex flex-col gap-3">
          {[
            ['🛡️', 'Visa PERC-aligned threat detection', 'text-brand'],
            ['⚡', 'Sub-200ms fraud scoring via Java engine', 'text-amber-400'],
            ['🔴', 'Campaign detection across 5 attack types', 'text-red-400'],
            ['📍', 'Geographic relay fraud pattern recognition', 'text-purple-400'],
          ].map(([emoji, text, color]) => (
            <div key={text} className="flex items-center gap-3 bg-bg-card/50 border border-border-dim rounded-lg px-4 py-2.5">
              <span className="text-base">{emoji}</span>
              <span className={`text-sm font-medium ${color}`}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center">
              <Shield size={16} className="text-black" />
            </div>
            <span className="text-lg font-bold text-gradient">PayGuard</span>
          </div>

          {/* Tabs */}
          <div className="flex bg-bg-card border border-border-dim rounded-xl p-1 mb-8">
            {['login', 'register'].map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(''); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all capitalize
                  ${tab === t ? 'bg-brand text-black' : 'text-text-sec hover:text-text-pri'}`}
              >
                {t === 'login' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-text-pri mb-1">
              {tab === 'login' ? 'Welcome back' : 'Create account'}
            </h2>
            <p className="text-text-sec text-sm">
              {tab === 'login' ? 'Sign in to your analyst dashboard' : 'Join the fraud intelligence platform'}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-5">
              <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
              <span className="text-sm text-red-300">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'register' && (
              <div>
                <label className="block text-xs text-text-sec mb-1.5 uppercase tracking-wider">Full Name</label>
                <input
                  name="name" value={form.name} onChange={handleChange} required
                  placeholder="Sreeram Sharma"
                  className="w-full bg-bg-card border border-border-dim rounded-lg px-4 py-3 text-sm text-text-pri placeholder-text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-text-sec mb-1.5 uppercase tracking-wider">Email</label>
              <input
                name="email" type="email" value={form.email} onChange={handleChange} required
                placeholder="analyst@payguard.io"
                className="w-full bg-bg-card border border-border-dim rounded-lg px-4 py-3 text-sm text-text-pri placeholder-text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs text-text-sec mb-1.5 uppercase tracking-wider">Password</label>
              <div className="relative">
                <input
                  name="password" type={showPwd ? 'text' : 'password'} value={form.password} onChange={handleChange} required
                  placeholder="••••••••"
                  className="w-full bg-bg-card border border-border-dim rounded-lg px-4 py-3 pr-11 text-sm text-text-pri placeholder-text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 transition-all"
                />
                <button type="button" onClick={() => setShowPwd(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-sec transition-colors">
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {tab === 'register' && (
              <div>
                <label className="block text-xs text-text-sec mb-1.5 uppercase tracking-wider">Role</label>
                <select
                  name="role" value={form.role} onChange={handleChange}
                  className="w-full bg-bg-card border border-border-dim rounded-lg px-4 py-3 text-sm text-text-pri focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 transition-all"
                >
                  <option value="analyst">Analyst</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full bg-brand hover:bg-[#00bfa6] disabled:opacity-60 disabled:cursor-not-allowed text-black font-semibold py-3 rounded-lg transition-all flex items-center justify-center gap-2 mt-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Authenticating...' : (tab === 'login' ? 'Sign In' : 'Create Account')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
