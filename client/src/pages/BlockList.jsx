import { useState, useEffect } from 'react';
import { LockKeyhole, UserX, Smartphone, Trash2, Plus } from 'lucide-react';
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
    } catch (err) { setError(err.response?.data?.message || 'FAILED'); } finally { setAdding(false); }
  };

  const users   = entries.filter(e => e.type === 'userId');
  const devices = entries.filter(e => e.type === 'deviceId');

  return (
    <Layout>
      <div className="p-6 max-w-[1200px] mx-auto">
        
        <div className="pixel-box border-red-500 p-5 mb-6 flex items-center justify-between bg-bg-card">
          <div className="flex items-center gap-4">
            <LockKeyhole size={32} className="text-red-500" />
            <div>
              <h1 className="text-2xl font-vt text-red-500 tracking-widest text-shadow-pixel">BLOCK_REGISTRY</h1>
              <div className="text-xs font-mono text-text-sec mt-1">PERMANENT QUARANTINE LIST</div>
            </div>
          </div>
          <button onClick={() => setShowAdd(!showAdd)} className="pixel-btn px-4 py-2 text-xs flex items-center gap-2 border-red-500 text-red-500 hover:bg-red-500/10">
            <Plus size={14} /> ADD_ENTRY
          </button>
        </div>

        {showAdd && (
          <div className="pixel-box border-red-500 p-5 mb-6 bg-red-500/5 relative">
            <div className="absolute top-0 right-0 bg-red-500 text-bg-primary text-[10px] font-pixel px-2 py-1 tracking-widest">INPUT_REQ</div>
            <h3 className="text-lg font-vt text-red-400 mb-4 tracking-widest">MANUAL_QUARANTINE_ENTRY</h3>
            {error && <div className="text-xs font-mono text-bg-primary bg-red-500 px-3 py-2 mb-4 inline-block">{error}</div>}
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-sm mb-5">
              <div>
                <label className="block text-[10px] text-text-sec mb-1">IDENTIFIER_TYPE</label>
                <select value={addForm.type} onChange={e=>setAddForm(f=>({...f,type:e.target.value}))} className="w-full bg-bg-primary border-2 border-red-500/50 p-2 text-text-pri focus:border-red-500 outline-none">
                  <option value="userId">USER_ID</option>
                  <option value="deviceId">DEVICE_ID</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-text-sec mb-1">TARGET_VALUE</label>
                <input value={addForm.value} onChange={e=>setAddForm(f=>({...f,value:e.target.value}))} placeholder="E.G. USER_99" className="w-full bg-bg-primary border-2 border-red-500/50 p-2 text-text-pri focus:border-red-500 outline-none uppercase" />
              </div>
              <div>
                <label className="block text-[10px] text-text-sec mb-1">REASON</label>
                <input value={addForm.reason} onChange={e=>setAddForm(f=>({...f,reason:e.target.value}))} placeholder="MANUAL INTERVENTION" className="w-full bg-bg-primary border-2 border-red-500/50 p-2 text-text-pri focus:border-red-500 outline-none uppercase" />
              </div>
            </div>
            
            <div className="flex gap-3">
              <button onClick={add} disabled={adding||!addForm.value||!addForm.reason} className="pixel-btn px-6 py-2 text-red-400 border-red-500">
                {adding ? 'WRITING...' : 'CONFIRM_LOCK'}
              </button>
              <button onClick={()=>{setShowAdd(false);setError('');}} className="pixel-btn px-6 py-2 text-text-sec">CANCEL</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="pixel-box border-border-mid overflow-hidden flex flex-col h-[600px]">
            <div className="bg-border-mid px-4 py-3 flex items-center justify-between">
              <h2 className="text-base font-vt text-text-pri tracking-widest flex items-center gap-2"><UserX size={16} className="text-red-400"/> USERS_LOCKED</h2>
              <span className="text-xs font-mono text-text-pri">{users.length} REC</span>
            </div>
            <div className="overflow-y-auto flex-1 bg-bg-card">
              <table className="w-full text-left font-mono text-xs">
                <thead className="sticky top-0 bg-bg-secondary border-b-2 border-border-mid shadow-sm">
                  <tr>
                    {['ID', 'REASON', 'DATE', 'ACT'].map(h => <th key={h} className="px-3 py-2 text-[10px] text-text-muted">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {loading ? Array.from({length:5}).map((_,i)=><SkeletonRow key={i} cols={4}/>) : users.length===0 ? <tr><td colSpan={4} className="p-8 text-center text-text-muted">NO_RECORDS</td></tr> : users.map(e => (
                    <tr key={e._id} className="border-b border-border-dim hover:bg-border-dim/50">
                      <td className="px-3 py-3 text-red-400">{e.value}</td>
                      <td className="px-3 py-3 text-text-sec max-w-[150px] truncate">{e.reason}</td>
                      <td className="px-3 py-3 text-text-muted">{new Date(e.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-3">
                        <button onClick={()=>remove(e._id)} disabled={removing===e._id} className="text-text-muted hover:text-red-500 transition-colors"><Trash2 size={14}/></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pixel-box border-border-mid overflow-hidden flex flex-col h-[600px]">
            <div className="bg-border-mid px-4 py-3 flex items-center justify-between">
              <h2 className="text-base font-vt text-text-pri tracking-widest flex items-center gap-2"><Smartphone size={16} className="text-orange-400"/> DEVICES_LOCKED</h2>
              <span className="text-xs font-mono text-text-pri">{devices.length} REC</span>
            </div>
            <div className="overflow-y-auto flex-1 bg-bg-card">
              <table className="w-full text-left font-mono text-xs">
                <thead className="sticky top-0 bg-bg-secondary border-b-2 border-border-mid shadow-sm">
                  <tr>
                    {['ID', 'REASON', 'DATE', 'ACT'].map(h => <th key={h} className="px-3 py-2 text-[10px] text-text-muted">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {loading ? Array.from({length:5}).map((_,i)=><SkeletonRow key={i} cols={4}/>) : devices.length===0 ? <tr><td colSpan={4} className="p-8 text-center text-text-muted">NO_RECORDS</td></tr> : devices.map(e => (
                    <tr key={e._id} className="border-b border-border-dim hover:bg-border-dim/50">
                      <td className="px-3 py-3 text-orange-400">{e.value}</td>
                      <td className="px-3 py-3 text-text-sec max-w-[150px] truncate">{e.reason}</td>
                      <td className="px-3 py-3 text-text-muted">{new Date(e.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-3">
                        <button onClick={()=>remove(e._id)} disabled={removing===e._id} className="text-text-muted hover:text-red-500 transition-colors"><Trash2 size={14}/></button>
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
