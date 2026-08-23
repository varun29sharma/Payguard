import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, RefreshCw, AlertTriangle, Shield, X } from 'lucide-react';
import Layout from '../components/shared/Layout';
import ForceGraph from '../components/GraphExplorer/ForceGraph';

import api from '../api/axiosConfig';

const NODE_COLORS = {
  userId: '#6366f1', deviceId: '#f59e0b', ipAddress: '#10b981', fingerprint: '#ec4899',
  accountId: '#8b5cf6', sessionId: '#06b6d4', walletId: '#f97316', email: '#ef4444', phone: '#14b8a6', transaction: '#94a3b8',
};

const TYPE_LABELS = {
  userId: 'User', deviceId: 'Device', ipAddress: 'IP Address', fingerprint: 'Fingerprint',
  accountId: 'Account', sessionId: 'Session', walletId: 'Wallet', email: 'Email', phone: 'Phone', transaction: 'Transaction',
};

export default function GraphExplorer() {
  const [loading, setLoading] = useState(true);
  const [graphData, setGraphData] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [depth, setDepth] = useState(2);
  const [maxNodes, setMaxNodes] = useState(200);
  const [showTxns, setShowTxns] = useState(true);
  const [graphError, setGraphError] = useState(null);

  const seedRef = useRef(null);

  // Build graph from seed
  const buildGraph = useCallback(async (seed, d, mn, itx) => {
    seedRef.current = seed;
    setGraphError(null);
    setLoading(true);
    try {
      const res = await api.post('/graph/build', { seed, depth: d ?? depth, maxNodes: mn ?? maxNodes, includeTransactions: itx ?? showTxns });
      setGraphData(res.data.data);
    } catch (err) {
      console.error('Graph build error:', err);
      setGraphError(err.response?.data?.message || 'Failed to build graph');
      setGraphData(null);
    } finally {
      setLoading(false);
    }
  }, [depth, maxNodes, showTxns]);

  // Search for identifiers
  const handleSearch = useCallback(async (q) => {
    setSearchQuery(q);
    if (!q || q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await api.get(`/graph/search?q=${encodeURIComponent(q)}`);
      setSearchResults(res.data.data || []);
    } catch (err) {
      console.error('Search error:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Select a search result and build graph from it
  const selectResult = useCallback((result) => {
    setSearchResults([]);
    setSearchQuery('');
    buildGraph({ [result.type]: result.value });
  }, [buildGraph]);

  // Click on a node in the graph to expand it
  const handleNodeClick = useCallback((node) => {
    if (!node || node.type === 'transaction') {
      setSelectedNode(node);
      return;
    }
    setSelectedNode(node);
    // Expand from this node
    buildGraph({ [node.type]: node.value });
  }, [buildGraph]);

  // Rebuild with changed params
  useEffect(() => {
    if (seedRef.current) buildGraph(seedRef.current);
  }, [depth, maxNodes, showTxns, buildGraph]);

  // Initial load via ref to avoid setState-in-effect
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      buildGraph({ userId: 'MULE_1' }, 2, 100, true);
    }
  }, [buildGraph]);

  // Detail panel data
  const connectedEdges = graphData?.edges?.filter(e => {
    const srcId = typeof e.source === 'object' ? e.source.id : e.source;
    const tgtId = typeof e.target === 'object' ? e.target.id : e.target;
    return srcId === selectedNode?.id || tgtId === selectedNode?.id;
  }) || [];

  return (
    <Layout>
      <div className="p-8 max-w-[1400px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="label mb-1">12 — GRAPH EXPLORER</div>
            <h1 className="text-3xl font-black tracking-tight uppercase">Identity Graph</h1>
            <p className="text-muted text-sm mt-1 font-mono">FORCE-DIRECTED VISUALIZATION OF CONNECTED ENTITIES</p>
          </div>
        </div>

        {/* Search + Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search user, device, IP, email…"
              className="input pl-8 text-sm"
            />
            {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">Searching…</span>}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 bg-card border border-hairline-strong shadow-lg max-h-64 overflow-y-auto mt-1">
                {searchResults.map((r, i) => (
                  <button key={i} onClick={() => selectResult(r)}
                    className="w-full text-left px-4 py-2.5 hover:bg-paper border-b border-hairline last:border-0 flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: NODE_COLORS[r.type] }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono truncate">{r.value}</div>
                      <div className="text-[10px] text-muted">{TYPE_LABELS[r.type] || r.type}</div>
                    </div>
                    {r.fraudScore > 0 && <span className="text-[10px] font-mono text-red-600">S:{r.fraudScore}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border border-hairline px-3 py-1.5">
            <span className="label">DEPTH</span>
            {[1, 2, 3].map(d => (
              <button key={d} onClick={() => setDepth(d)}
                className={`px-2 py-0.5 text-[11px] font-mono ${depth === d ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}>
                {d}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 border border-hairline px-3 py-1.5">
            <span className="label">MAX</span>
            {[50, 100, 200, 300].map(n => (
              <button key={n} onClick={() => setMaxNodes(n)}
                className={`px-2 py-0.5 text-[11px] font-mono ${maxNodes === n ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}>
                {n}
              </button>
            ))}
          </div>

          <button onClick={() => setShowTxns(!showTxns)}
            className={`btn btn-ghost btn-sm ${showTxns ? 'font-bold' : 'text-muted'}`}>
            {showTxns ? 'HIDE' : 'SHOW'} TXNS
          </button>
        </div>

        {/* Main area: Graph + Detail Panel */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
          {/* Graph */}
          <div className="relative">
            {loading && !graphData && (
              <div className="absolute inset-0 flex items-center justify-center bg-paper/50 z-10">
                <div className="text-center">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-muted" />
                  <div className="text-xs text-muted">Building graph…</div>
                </div>
              </div>
            )}
            {graphError && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="text-center text-red-600">
                  <AlertTriangle size={20} className="mx-auto mb-2" />
                  <div className="text-xs">{graphError}</div>
                </div>
              </div>
            )}
            {graphData && (
              <ForceGraph
                nodes={graphData.nodes}
                edges={graphData.edges}
                onNodeClick={handleNodeClick}
                selectedNodeId={selectedNode?.id}
                width={Math.min(1100, typeof window !== 'undefined' ? window.innerWidth - 420 : 900)}
                height={600}
              />
            )}

            {/* Stats overlay */}
            {graphData?.stats && (
              <div className="absolute top-3 right-3 bg-card/90 border border-hairline p-3 text-[10px] space-y-1">
                <div className="flex gap-3">
                  <span><span className="font-bold">{graphData.stats.totalNodes}</span> <span className="text-muted">nodes</span></span>
                  <span><span className="font-bold">{graphData.stats.edges}</span> <span className="text-muted">edges</span></span>
                </div>
                <div className="flex gap-3">
                  <span><span className="font-bold">{graphData.stats.identifierNodes}</span> <span className="text-muted">identifiers</span></span>
                  <span><span className="font-bold">{graphData.stats.transactionNodes}</span> <span className="text-muted">txns</span></span>
                </div>
                {graphData.stats.blocked > 0 && (
                  <div className="text-red-600 font-bold">{graphData.stats.blocked} blocked</div>
                )}
                {graphData.stats.flagged > 0 && (
                  <div className="text-amber-600 font-bold">{graphData.stats.flagged} flagged</div>
                )}
              </div>
            )}
          </div>

          {/* Detail Panel */}
          <div className="space-y-4">
            {selectedNode ? (
              <div className="border border-hairline-strong p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: NODE_COLORS[selectedNode.type] }} />
                    <span className="font-bold text-sm">{TYPE_LABELS[selectedNode.type] || selectedNode.type}</span>
                  </div>
                  <button onClick={() => setSelectedNode(null)} className="text-muted hover:text-ink"><X size={14} /></button>
                </div>

                <div className="font-mono text-xs break-all bg-paper p-2 border border-hairline">{selectedNode.value}</div>

                {/* Status badges */}
                <div className="flex gap-2 flex-wrap">
                  {selectedNode.blocked && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold border border-red-400 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      <Shield size={10} /> BLOCKED
                    </span>
                  )}
                  {selectedNode.flagged && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold border border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      <AlertTriangle size={10} /> FLAGGED
                    </span>
                  )}
                  {!selectedNode.blocked && !selectedNode.flagged && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold border border-green-400 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300">
                      CLEAR
                    </span>
                  )}
                </div>

                {/* Stats */}
                {selectedNode.type === 'transaction' && (
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="border border-hairline p-2">
                      <div className="text-muted">Amount</div>
                      <div className="font-bold">₹{selectedNode.amount?.toLocaleString()}</div>
                    </div>
                    <div className="border border-hairline p-2">
                      <div className="text-muted">Score</div>
                      <div className="font-bold">{selectedNode.fraudScore}</div>
                    </div>
                  </div>
                )}

                {/* Connections */}
                <div>
                  <div className="label mb-2">CONNECTIONS ({connectedEdges.length})</div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {connectedEdges.map((e, i) => {
                      const srcId = typeof e.source === 'object' ? e.source.id : e.source;
                      const tgtId = typeof e.target === 'object' ? e.target.id : e.target;
                      const otherId = srcId === selectedNode.id ? tgtId : srcId;
                      const otherType = otherId.split(':')[0];
                      const otherValue = otherId.split(':').slice(1).join(':');
                      return (
                        <div key={i} className="flex items-center gap-2 text-[11px] py-1 border-b border-hairline last:border-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: NODE_COLORS[otherType] }} />
                          <span className="text-muted">{TYPE_LABELS[otherType]}:</span>
                          <span className="font-mono truncate flex-1">{otherValue?.slice(0, 20)}</span>
                          {e.amount && <span className="text-muted">₹{e.amount?.toLocaleString()}</span>}
                        </div>
                      );
                    })}
                    {connectedEdges.length === 0 && <div className="text-xs text-muted">No connections</div>}
                  </div>
                </div>

                <button onClick={() => {
                  if (selectedNode.type !== 'transaction') {
                    buildGraph({ [selectedNode.type]: selectedNode.value });
                  }
                }} className="btn btn-ghost btn-sm w-full" disabled={selectedNode.type === 'transaction'}>
                  EXPAND FROM THIS NODE
                </button>
              </div>
            ) : (
              <div className="border border-hairline-strong p-5 space-y-4">
                <h3 className="font-bold text-sm">How to Explore</h3>
                <div className="text-[11px] text-muted space-y-2">
                  <p><strong>Search</strong> — type a user ID, device, IP, or email to find connected entities.</p>
                  <p><strong>Click a node</strong> — view its details and connections in this panel.</p>
                  <p><strong>Click "Expand"</strong> — rebuild the graph centered on this entity.</p>
                  <p><strong>Drag nodes</strong> — rearrange the layout to see clusters.</p>
                  <p><strong>Hover</strong> — highlight all direct connections and dim the rest.</p>
                </div>
                <div className="space-y-2 mt-4">
                  <div className="label">QUICK START</div>
                  {[
                    { label: 'MULE_1', seed: { userId: 'MULE_1' } },
                    { label: 'DEVICE_SHARED', seed: { deviceId: 'DEVICE_SHARED' } },
                    { label: 'All Mule Traffic', seed: { deviceId: 'DEVICE_MULE_9' } },
                  ].map(q => (
                    <button key={q.label} onClick={() => buildGraph(q.seed)}
                      className="w-full text-left px-3 py-2 border border-hairline text-[11px] font-mono hover:border-accent">
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Node type legend */}
            <div className="border border-hairline-strong p-4 space-y-2">
              <h3 className="font-bold text-sm">Node Types</h3>
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                {Object.entries(TYPE_LABELS).filter(([k]) => k !== 'transaction').map(([type, label]) => (
                  <div key={type} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: NODE_COLORS[type] }} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-hairline text-[10px] text-muted space-y-1">
                <div className="flex items-center gap-2"><span className="w-3 h-3 border-2 border-red-400 rounded-full" /><span>Blocked</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 border-2 border-amber-400 rounded-full border-dashed" /><span>Flagged</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 bg-gray-300 rounded-full" /><span>Transaction</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
