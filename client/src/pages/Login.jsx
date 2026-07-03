import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../api/axiosConfig'

export default function Login(){
  const [mode, setMode] = useState('login') // or 'register'
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { login: authLogin } = useAuth()

  const [loginData, setLoginData] = useState({ email: '', password: '' })
  const [regData, setRegData] = useState({ name: '', email: '', password: '', role: 'analyst' })

  async function handleLogin(e){
    e.preventDefault();
    setError('')
    setLoading(true)
    try{
      const res = await api.post('/auth/login', loginData)
      // keep auth logic exactly as required
      localStorage.setItem('pg_token', res.data.token)
      localStorage.setItem('pg_user', JSON.stringify(res.data.user))
      // also sync context
      authLogin(res.data.user, res.data.token)
      navigate('/dashboard')
    }catch(err){
      setError(err.response?.data?.message || 'Invalid credentials')
    }finally{ setLoading(false) }
  }

  async function handleRegister(e){
    e.preventDefault();
    setError('')
    setLoading(true)
    try{
      await api.post('/auth/register', regData)
      toast.success('Registration successful! Please login.')
      setMode('login')
    }catch(err){
      setError(err.response?.data?.message || 'Registration failed')
    }finally{ setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-3xl w-full grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="hidden md:flex flex-col justify-center p-8 card">
          <div className="text-brand text-3xl font-bold">PayGuard</div>
          <div className="mt-4 text-[var(--text-secondary)]">Real-time fraud intelligence for UPI networks</div>
          <div className="mt-6 text-sm text-[var(--text-secondary)]">Secure dashboard for monitoring and investigating UPI transactions.</div>
        </div>

        <div className="p-8 card">
          <div className="flex items-center justify-between mb-6">
            <div className="text-lg font-semibold">{mode === 'login' ? 'Sign in' : 'Create account'}</div>
            <div className="text-xs text-[var(--text-secondary)]">Need an account? <button className="text-brand ml-2" onClick={()=> setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Register' : 'Login'}</button></div>
          </div>

          {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-sm text-[var(--text-secondary)]">Email</label>
                <input className="w-full mt-1 p-2 input-base" type="email" required value={loginData.email} onChange={e=> setLoginData({...loginData, email: e.target.value})} />
              </div>
              <div>
                <label className="text-sm text-[var(--text-secondary)]">Password</label>
                <div className="mt-1 relative">
                  <input className="w-full p-2 input-base pr-10" type={showPassword ? 'text' : 'password'} required value={loginData.password} onChange={e=> setLoginData({...loginData, password: e.target.value})} />
                  <button type="button" onClick={()=> setShowPassword(s=>!s)} className="absolute right-2 top-2 text-[var(--text-secondary)]">
                    {showPassword ? <EyeOff size={16}/> : <Eye size={16}/>} 
                  </button>
                </div>
              </div>
              <button type="submit" className="w-full bg-brand text-black font-semibold rounded-lg py-2 hover:bg-[#00bfa6] transition-all flex items-center justify-center" disabled={loading}>
                {loading ? <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin mr-2"/> : null}
                Sign in
              </button>
              <div className="text-xs text-[var(--text-secondary)]">Don’t have an account? <button type="button" className="text-brand" onClick={()=> setMode('register')}>Register</button></div>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="text-sm text-[var(--text-secondary)]">Name</label>
                <input className="w-full mt-1 p-2 input-base" type="text" required value={regData.name} onChange={e=> setRegData({...regData, name: e.target.value})} />
              </div>
              <div>
                <label className="text-sm text-[var(--text-secondary)]">Email</label>
                <input className="w-full mt-1 p-2 input-base" type="email" required value={regData.email} onChange={e=> setRegData({...regData, email: e.target.value})} />
              </div>
              <div>
                <label className="text-sm text-[var(--text-secondary)]">Password</label>
                <div className="mt-1 relative">
                  <input className="w-full p-2 input-base pr-10" type={showPassword ? 'text' : 'password'} required value={regData.password} onChange={e=> setRegData({...regData, password: e.target.value})} />
                  <button type="button" onClick={()=> setShowPassword(s=>!s)} className="absolute right-2 top-2 text-[var(--text-secondary)]">
                    {showPassword ? <EyeOff size={16}/> : <Eye size={16}/>} 
                  </button>
                </div>
              </div>
              <div>
                <label className="text-sm text-[var(--text-secondary)]">Role</label>
                <select className="w-full mt-1 p-2 input-base" value={regData.role} onChange={e=> setRegData({...regData, role: e.target.value})}>
                  <option value="analyst">Analyst</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button type="submit" className="w-full bg-brand text-black font-semibold rounded-lg py-2 hover:bg-[#00bfa6] transition-all" disabled={loading}>
                {loading ? <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin mr-2"/> : null}
                Create account
              </button>
              <div className="text-xs text-[var(--text-secondary)]">Already registered? <button type="button" className="text-brand" onClick={()=> setMode('login')}>Sign in</button></div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}