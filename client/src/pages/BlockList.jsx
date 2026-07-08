import { useState, useEffect } from 'react';
import { Lock, UserX, Smartphone, Trash2, Plus } from 'lucide-react';
import Layout from '../components/shared/Layout';
import { SkeletonRow } from '../components/shared/Skeleton';
import api from '../api/axiosConfig';

export default function BlockList() {
  const [entries,  setEntries]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [removing, setRemoving] = useState(null);
  const [showAdd,  setShowAdd]  = useState(false);
  const [addForm,  setAddForm]  = useState({ type: 'userId', value: '', reason: '' });
  const [adding,   setAdding]   = useState(false);
  const [error,    setError]    = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/blocklist');
      setEntries(data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const remove = async (id) => {
    setRemoving(id);
    try {
      await api.delete(`/blocklist/${id}`);
      setEntries(prev => prev.filter(e => e._id !== id));
    } catch (err) {
      console.error(err);
    } finally {
      setRemoving(null);
    }
  };

  const add = async () => {
    if (!addForm.value || !addForm.reason) return;
    setAdding(true);
    setError('');
    try {
      const { data } = await api.post('/blocklist', addForm);
      setEntries(prev => [data.data, ...prev]);
      setAddForm({ type: 'userId', value: '', reason: '' });
      setShowAdd(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add block entry');
    } finally {
      setAdding(false);
    }
  };

  const users   = entries.filter(e => e.type === 'userId');
  const devices = entries.filter(e => e.type === 'deviceId');

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Lock size={18} className="text-brand" />
              <h1 className="text-xl font-bold text-text-pri">Block List</h1>
            </div>
            <p className="text-sm text-text-muted">
              Blocked users and devices — all future transactions from these entities are automatically rejected
            </p>
          </div>
          <button onClick={() => setShowAdd(s => !s)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-brand text-black font-semibold rounded-lg hover:bg-[#00bfa6] transition-all">
            <Plus size={12} />
            Add Block
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="bg-bg-card border border-border-dim rounded-xl p-5 mb-6 animate-fade-in">
            <h3 className="text-sm font-semibold text-text-pri mb-4">Manually Block Entity</h3>
            {error && <div className="text-xs text-red-400 mb-3 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-text-muted uppercase tracking-widest mb-1">Block Type</label>
                <select value={addForm.type} onChange={e => setAddForm(f => ({...f, type: e.target.value}))}
                  className="w-full bg-bg-primary border border-border-dim rounded-lg px-3 py-2 text-sm text-text-pri focus:border-brand focus:outline-none">
                  <option value="userId">User ID</option>
                  <option value="deviceId">Device ID</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-text-muted uppercase tracking-widest mb-1">
                  {addForm.type === 'userId' ? 'User ID' : 'Device ID'}
                </label>
                <input value={addForm.value} onChange={e => setAddForm(f => ({...f, value: e.target.value}))}
                  placeholder={addForm.type === 'userId' ? 'USER_5' : 'DEVICE_A1'}
                  className="w-full bg-bg-primary border border-border-dim rounded-lg px-3 py-2 text-sm text-text-pri placeholder-text-muted focus:border-brand focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-text-muted uppercase tracking-widest mb-1">Reason</label>
                <input value={addForm.reason} onChange={e => setAddForm(f => ({...f, reason: e.target.value}))}
                  placeholder="Manual block — suspicious activity"
                  className="w-full bg-bg-primary border border-border-dim rounded-lg px-3 py-2 text-sm text-text-pri placeholder-text-muted focus:border-brand focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={add} disabled={adding || !addForm.value || !addForm.reason}
                className="text-xs px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/15 transition-all disabled:opacity-50">
                {adding ? 'Adding...' : 'Add Block Entry'}
              </button>
              <button onClick={() => { setShowAdd(false); setError(''); }}
                className="text-xs px-4 py-2 border border-border-dim text-text-muted rounded-lg hover:border-border-mid transition-all">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Total Blocked', value: entries.length, icon: <Lock size={14} />, color: 'text-brand' },
            { label: 'Users',         value: users.length,   icon: <UserX size={14} />, color: 'text-red-400' },
            { label: 'Devices',       value: devices.length, icon: <Smartphone size={14} />, color: 'text-orange-400' },
          ].map(s => (
            <div key={s.label} className="bg-bg-card border border-border-dim rounded-xl px-4 py-3 flex items-center gap-3">
              <span className={s.color}>{s.icon}</span>
              <div>
                <div className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</div>
                <div className="text-xs text-text-muted">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Users table */}
        <div className="bg-bg-card border border-border-dim rounded-xl overflow-hidden mb-4">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border-dim">
            <UserX size={13} className="text-red-400" />
            <h2 className="text-sm font-semibold text-text-pri">Blocked Users</h2>
            <span className="text-xs text-text-muted ml-auto">{users.length} entries</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-dim">
                {['User ID', 'Reason', 'Blocked By', 'Date', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] text-text-muted uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({length:3}).map((_,i) => <SkeletonRow key={i} cols={5} />)
              ) : users.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">No blocked users</td></tr>
              ) : users.map(e => (
                <tr key={e._id} className="border-b border-border-dim hover:bg-bg-card2 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm text-red-400">{e.value}</td>
                  <td className="px-4 py-3 text-xs text-text-sec max-w-xs truncate">{e.reason}</td>
                  <td className="px-4 py-3 text-xs text-text-muted">{e.blockedBy}</td>
                  <td className="px-4 py-3 text-xs text-text-muted font-mono">{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => remove(e._id)} disabled={removing === e._id}
                      className="text-text-muted hover:text-red-400 transition-colors disabled:opacity-40">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Devices table */}
        <div className="bg-bg-card border border-border-dim rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border-dim">
            <Smartphone size={13} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-text-pri">Blocked Devices</h2>
            <span className="text-xs text-text-muted ml-auto">{devices.length} entries</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-dim">
                {['Device ID', 'Reason', 'Blocked By', 'Date', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] text-text-muted uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({length:2}).map((_,i) => <SkeletonRow key={i} cols={5} />)
              ) : devices.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">No blocked devices</td></tr>
              ) : devices.map(e => (
                <tr key={e._id} className="border-b border-border-dim hover:bg-bg-card2 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm text-orange-400">{e.value}</td>
                  <td className="px-4 py-3 text-xs text-text-sec max-w-xs truncate">{e.reason}</td>
                  <td className="px-4 py-3 text-xs text-text-muted">{e.blockedBy}</td>
                  <td className="px-4 py-3 text-xs text-text-muted font-mono">{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => remove(e._id)} disabled={removing === e._id}
                      className="text-text-muted hover:text-red-400 transition-colors disabled:opacity-40">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
