import { useRef, useEffect, useCallback, useState } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';

const NODE_COLORS = {
  userId:      '#6366f1',
  deviceId:    '#f59e0b',
  ipAddress:   '#10b981',
  fingerprint: '#ec4899',
  accountId:   '#8b5cf6',
  sessionId:   '#06b6d4',
  walletId:    '#f97316',
  email:       '#ef4444',
  phone:       '#14b8a6',
  transaction: '#94a3b8',
};

const NODE_RADIUS = { transaction: 5, userId: 10, deviceId: 12, ipAddress: 8, fingerprint: 8, accountId: 8, sessionId: 6, walletId: 8, email: 8, phone: 8 };
const TYPE_LABELS = { userId: 'USER', deviceId: 'DEVICE', ipAddress: 'IP', fingerprint: 'FP', accountId: 'ACCT', sessionId: 'SESSION', walletId: 'WALLET', email: 'EMAIL', phone: 'PHONE', transaction: 'TXN' };

/**
 * ForceGraph — renders a force-directed graph using SVG with d3-force.
 * Simulation runs in an effect; rendering uses a direct SVG DOM update loop
 * to avoid React setState during effects entirely.
 */
export default function ForceGraph({ nodes, edges, onNodeClick, selectedNodeId, width = 900, height = 600 }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const hoveredRef = useRef(null);
  const selectedRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  // Keep selectedRef in sync via effect (not during render)
  useEffect(() => { selectedRef.current = selectedNodeId; }, [selectedNodeId]);

  // Build + start simulation, render via direct DOM updates
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (simRef.current) { simRef.current.stop(); simRef.current = null; }

    // Clear old content
    svg.innerHTML = '';

    if (!nodes?.length) return;

    // Build node map
    const nodeMap = new Map();
    const simN = nodes.map(n => {
      const sn = { ...n, x: width / 2 + (Math.random() - 0.5) * 200, y: height / 2 + (Math.random() - 0.5) * 200 };
      nodeMap.set(n.id, sn);
      return sn;
    });

    const simE = edges
      .filter(e => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        return nodeMap.has(s) && nodeMap.has(t);
      })
      .map(e => ({ ...e, source: typeof e.source === 'object' ? e.source.id : e.source, target: typeof e.target === 'object' ? e.target.id : e.target }));

    nodesRef.current = simN;
    edgesRef.current = simE;

    // Create SVG groups
    const edgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const nodeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(edgeG);
    svg.appendChild(nodeG);

    // Create edge elements
    const edgeEls = simE.map(() => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke', '#94a3b8');
      line.setAttribute('stroke-width', '1');
      edgeG.appendChild(line);
      return line;
    });

    // Create node elements
    const nodeEls = simN.map(n => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.style.cursor = 'pointer';

      const r = NODE_RADIUS[n.type] || 8;
      const color = NODE_COLORS[n.type] || '#94a3b8';

      // Blocked/flagged ring
      if (n.blocked) {
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring.setAttribute('r', String(r + 4));
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#ef4444');
        ring.setAttribute('stroke-width', '2');
        ring.setAttribute('opacity', '0.6');
        g.appendChild(ring);
      } else if (n.flagged) {
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring.setAttribute('r', String(r + 3));
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#f59e0b');
        ring.setAttribute('stroke-width', '1.5');
        ring.setAttribute('opacity', '0.5');
        ring.setAttribute('stroke-dasharray', '3,2');
        g.appendChild(ring);
      }

      // Selection ring
      const selRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      selRing.setAttribute('r', String(r + 2));
      selRing.setAttribute('fill', 'none');
      selRing.setAttribute('stroke', color);
      selRing.setAttribute('stroke-width', '2');
      selRing.setAttribute('opacity', '0');
      g.appendChild(selRing);

      // Main circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', String(r));
      circle.setAttribute('fill', color);
      circle.setAttribute('stroke', n.type === 'transaction' ? 'none' : '#fff');
      circle.setAttribute('stroke-width', n.type === 'transaction' ? '0' : '1.5');
      g.appendChild(circle);

      // Transaction inner dot
      if (n.type === 'transaction') {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('r', '2');
        dot.setAttribute('fill', '#fff');
        dot.setAttribute('opacity', '0.8');
        g.appendChild(dot);
      }

      // Label
      if (n.type !== 'transaction') {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('y', String(r + 12));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '9');
        label.setAttribute('font-family', 'monospace');
        label.setAttribute('fill', '#6b7280');
        label.setAttribute('opacity', '0.7');
        label.textContent = n.value?.slice(0, 12) || '';
        g.appendChild(label);

        // Type badge
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badge.setAttribute('y', String(-r - 5));
        badge.setAttribute('text-anchor', 'middle');
        badge.setAttribute('font-size', '7');
        badge.setAttribute('font-weight', 'bold');
        badge.setAttribute('fill', color);
        badge.textContent = TYPE_LABELS[n.type] || n.type;
        g.appendChild(badge);
      }

      // Store refs for tick updates
      g._node = n;
      g._selRing = selRing;
      g._circle = circle;

      // Interaction handlers
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onNodeClick) onNodeClick(n);
      });

      g.addEventListener('mouseenter', (e) => {
        hoveredRef.current = n.id;
        const rect = svg.getBoundingClientRect();
        setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top - 10, node: n });
      });

      g.addEventListener('mouseleave', () => {
        hoveredRef.current = null;
        setTooltip(null);
      });

      nodeG.appendChild(g);
      return g;
    });

    // Simulation tick: update positions directly in DOM
    const tick = () => {
      const focusId = hoveredRef.current || selectedRef.current;
      const connected = new Set();
      if (focusId) {
        connected.add(focusId);
        simE.forEach(e => {
          const s = typeof e.source === 'object' ? e.source.id : e.source;
          const t = typeof e.target === 'object' ? e.target.id : e.target;
          if (s === focusId) connected.add(t);
          if (t === focusId) connected.add(s);
        });
      }

      // Update edges
      simE.forEach((e, i) => {
        const s = typeof e.source === 'object' ? e.source : null;
        const t = typeof e.target === 'object' ? e.target : null;
        if (!s || !t || !edgeEls[i]) return;
        edgeEls[i].setAttribute('x1', String(s.x));
        edgeEls[i].setAttribute('y1', String(s.y));
        edgeEls[i].setAttribute('x2', String(t.x));
        edgeEls[i].setAttribute('y2', String(t.y));
        if (connected.size > 0) {
          edgeEls[i].setAttribute('opacity', (connected.has(s.id) && connected.has(t.id)) ? '0.7' : '0.06');
        } else {
          edgeEls[i].setAttribute('opacity', '0.25');
        }
      });

      // Update nodes
      nodeEls.forEach(g => {
        const n = g._node;
        g.setAttribute('transform', `translate(${n.x},${n.y})`);
        const dimmed = connected.size > 0 && !connected.has(n.id);
        g._circle.setAttribute('opacity', dimmed ? '0.15' : '0.9');
        g._selRing.setAttribute('opacity', (n.id === focusId) ? '0.8' : '0');
      });
    };

    // Run simulation
    const sim = forceSimulation(simN)
      .force('link', forceLink(simE).id(d => d.id).distance(60).strength(0.3))
      .force('charge', forceManyBody().strength(-120).distanceMax(300))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide().radius(d => (NODE_RADIUS[d.type] || 8) + 4))
      .alphaDecay(0.02)
      .on('tick', tick);

    simRef.current = sim;

    return () => sim.stop();
  }, [nodes?.length, edges?.length, width, height, onNodeClick]);

  const handleSvgClick = useCallback(() => {
    if (onNodeClick) onNodeClick(null);
  }, [onNodeClick]);

  return (
    <div className="relative border border-hairline-strong bg-white dark:bg-ink-soft/30 overflow-hidden" style={{ width, height }}>
      <svg ref={svgRef} width={width} height={height} onClick={handleSvgClick} className="cursor-grab active:cursor-grabbing" />

      {/* Tooltip */}
      {tooltip && (
        <div className="absolute pointer-events-none z-50 bg-card border border-hairline-strong p-3 shadow-lg max-w-[220px]"
          style={{ left: tooltip.x + 12, top: tooltip.y - 60 }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: NODE_COLORS[tooltip.node.type] }} />
            <span className="text-[10px] font-bold uppercase">{TYPE_LABELS[tooltip.node.type] || tooltip.node.type}</span>
          </div>
          <div className="text-xs font-mono break-all">{tooltip.node.value?.slice(0, 40)}</div>
          {tooltip.node.amount && <div className="text-[10px] text-muted mt-1">₹{tooltip.node.amount?.toLocaleString()}</div>}
          {tooltip.node.blocked && <div className="text-[10px] text-red-600 font-bold mt-1">BLOCKED</div>}
          {tooltip.node.flagged && <div className="text-[10px] text-amber-600 font-bold mt-1">FLAGGED</div>}
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 bg-card/90 border border-hairline p-2 text-[9px]">
        {Object.entries(TYPE_LABELS).filter(([k]) => k !== 'transaction').map(([type, label]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[type] }} />
            <span className="text-muted">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
