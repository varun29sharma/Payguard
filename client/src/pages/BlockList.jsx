import { useState, useEffect } from 'react';
import { Plus, Trash2, UserX, Smartphone } from 'lucide-react';
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
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch of the registry
  useEffect(() => { load(); }, []);

  const remove = async (id) => {
    setRemoving(id);
    try {
      await api.delete(`/blocklist/${id}`);
      setEntries(prev => prev.filter(e => e._id !== id));
    } catch (err) { console.error(err); } finally { setRemoving(null); }
  };

  const add = async () => {
    if (!addForm.value || !addForm.reason) return;
    setAdding(true); setError('');
    try {
      await api.post('/blocklist', addForm);
      await load();
      setAddForm({ type: 'userId', value: '', reason: '' });
      setShowAdd(false);
    } catch (err) { setError(err.response?.data?.message || 'Failed'); } finally { setAdding(false); }
  };

  const users   = entries.filter(e => e.type === 'userId');
  const devices = entries.filter(e => e.type === 'deviceId');

  return (
    <Layout>
      <div className="p-10 max-w-[1200px] mx-auto">
        <div className="flex items-start justify-between mb-10">
          <div>
            <div className="label mb-2">05 — Blocklist</div>
            <h1 className="text-5xl font-black tracking-tight leading-none">Block registry</h1>
            <div className="mt-3 font-mono text-xs uppercase tracking-wider text-muted">Permanent record of every locked entity</div>
          </div>
          <button onClick={() => setShowAdd(!showAdd)} className="btn btn-sm">
            <Plus size={13} /> Add entry
          </button>
        </div>

        {showAdd && (
          <div className="border border-accent/40 bg-card p-7 mb-10">
            <div className="flex items-center gap-3 mb-6">
              <span className="text-accent font-bold">!</span>
              <h3 className="text-lg font-bold tracking-tight">Manual quarantine entry</h3>
            </div>
            {error && <div className="text-xs font-mono text-accent bg-accent/5 border border-accent/40 px-3 py-2 mb-5 inline-block uppercase">{error}</div>}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div>
                <label className="label block mb-1">Identifier type</label>
                <select value={addForm.type} onChange={e=>setAddForm(f=>({...f,type:e.target.value}))} className="input uppercase">
                  <option value="userId">User</option>
                  <option value="deviceId">Device</option>
                </select>
              </div>
              <div>
                <label className="label block mb-1">Target value</label>
                <input value={addForm.value} onChange={e=>setAddForm(f=>({...f,value:e.target.value}))} placeholder="e.g. USER_99" className="input uppercase" />
              </div>
              <div>
                <label className="label block mb-1">Reason</label>
                <input value={addForm.reason} onChange={e=>setAddForm(f=>({...f,reason:e.target.value}))} placeholder="Manual intervention" className="input" />
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={add} disabled={adding||!addForm.value||!addForm.reason} className="btn btn-sm btn-accent">
                {adding ? 'Writing…' : 'Confirm block'}
              </button>
              <button onClick={()=>{setShowAdd(false);setError('');}} className="btn btn-sm btn-ghost">Cancel</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="flex flex-col h-[600px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2"><UserX size={16} className="text-accent" /> Locked users</h2>
              <span className="label">{users.length} records</span>
            </div>
            <div className="overflow-y-auto flex-1 bg-card border border-hairline">
              <table className="w-full text-left font-mono text-xs">
                <thead className="sticky top-0 bg-paper border-b border-hairline">
                  <tr>
                    {['Id', 'Reason', 'Date', 'Act'].map(h => <th key={h} className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {loading ? Array.from({length:5}).map((_,i)=><SkeletonRow key={i} cols={4}/>) : users.length===0 ? <tr><td colSpan={4} className="p-8 text-center text-muted uppercase tracking-wider">No records</td></tr> : users.map(e => (
                    <tr key={e._id} className="border-b border-hairline hover:bg-paper">
                      <td className="px-4 py-3 font-semibold text-accent">{e.value}</td>
                      <td className="px-4 py-3 text-ink-soft max-w-[150px] truncate">{e.reason}</td>
                      <td className="px-4 py-3 text-muted">{new Date(e.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <button onClick={()=>remove(e._id)} disabled={removing===e._id} className="text-muted hover:text-accent transition-colors"><Trash2 size={14}/></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col h-[600px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2"><Smartphone size={16} className="text-accent" /> Locked devices</h2>
              <span className="label">{devices.length} records</span>
            </div>
            <div className="overflow-y-auto flex-1 bg-card border border-hairline">
              <table className="w-full text-left font-mono text-xs">
                <thead className="sticky top-0 bg-paper border-b border-hairline">
                  <tr>
                    {['Id', 'Reason', 'Date', 'Act'].map(h => <th key={h} className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {loading ? Array.from({length:5}).map((_,i)=><SkeletonRow key={i} cols={4}/>) : devices.length===0 ? <tr><td colSpan={4} className="p-8 text-center text-muted uppercase tracking-wider">No records</td></tr> : devices.map(e => (
                    <tr key={e._id} className="border-b border-hairline hover:bg-paper">
                      <td className="px-4 py-3 font-semibold text-accent">{e.value}</td>
                      <td className="px-4 py-3 text-ink-soft max-w-[150px] truncate">{e.reason}</td>
                      <td className="px-4 py-3 text-muted">{new Date(e.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <button onClick={()=>remove(e._id)} disabled={removing===e._id} className="text-muted hover:text-accent transition-colors"><Trash2 size={14}/></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
