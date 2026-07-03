import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../api/axiosConfig'

export default function Register(){
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'analyst' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function handleSubmit(e){
    e.preventDefault();
    setError('')
    setLoading(true)
    try{
      await api.post('/auth/register', form)
      toast.success('Registration successful! Please login.')
      navigate('/login')
    }catch(err){
      setError(err.response?.data?.message || 'Registration failed')
    }finally{ setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md card p-6">
        <h3 className="text-lg font-semibold mb-4">Create an account</h3>
        {error && <div className="text-red-400 mb-3">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input className="w-full p-2 input-base" placeholder="Full name" required value={form.name} onChange={e=> setForm({...form, name: e.target.value})} />
          <input className="w-full p-2 input-base" placeholder="Email" type="email" required value={form.email} onChange={e=> setForm({...form, email: e.target.value})} />
          <input className="w-full p-2 input-base" placeholder="Password" type="password" required value={form.password} onChange={e=> setForm({...form, password: e.target.value})} />
          <select className="w-full p-2 input-base" value={form.role} onChange={e=> setForm({...form, role: e.target.value})}>
            <option value="analyst">Analyst</option>
            <option value="admin">Admin</option>
          </select>
          <button className="w-full bg-brand text-black font-semibold rounded-lg py-2" disabled={loading}>
            {loading ? <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin inline-block mr-2" /> : null}
            Create account
          </button>
        </form>
        <div className="text-xs text-[var(--text-secondary)] mt-3">Already have an account? <Link to="/login" className="text-brand">Sign in</Link></div>
      </div>
    </div>
  )
}