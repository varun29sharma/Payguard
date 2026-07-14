const configs = {
  clear:          { label: 'CLEAR',          cls: 'bg-green-500/10 text-green-400 border-green-500'  },
  review:         { label: 'REVIEW',         cls: 'bg-amber-500/10 text-amber-400 border-amber-500'  },
  blocked:        { label: 'BLOCKED',        cls: 'bg-red-500/10 text-red-400 border-red-500'        },
  open:           { label: 'OPEN',           cls: 'bg-red-500/10 text-red-400 border-red-500'        },
  resolved:       { label: 'RESOLVED',       cls: 'bg-green-500/10 text-green-400 border-green-500'  },
  false_positive: { label: 'FALSE POS',      cls: 'bg-text-muted/10 text-text-sec border-text-muted' },
  escalated:      { label: 'ESCALATED',      cls: 'bg-purple-500/10 text-purple-400 border-purple-500'},
  active:         { label: 'ACTIVE',         cls: 'bg-red-500/10 text-red-400 border-red-500'        },
  investigating:  { label: 'INVESTIGATING',  cls: 'bg-amber-500/10 text-amber-400 border-amber-500'  },
  contained:      { label: 'CONTAINED',      cls: 'bg-green-500/10 text-green-400 border-green-500'  },
  dismissed:      { label: 'DISMISSED',      cls: 'bg-text-muted/10 text-text-sec border-text-muted' },
  CRITICAL:       { label: 'CRITICAL',       cls: 'bg-red-500/20 text-red-400 border-red-500 animate-pulse-fast'},
  HIGH:           { label: 'HIGH',           cls: 'bg-orange-500/10 text-orange-400 border-orange-500'},
  MEDIUM:         { label: 'MEDIUM',         cls: 'bg-amber-500/10 text-amber-400 border-amber-500'  },
  LOW:            { label: 'LOW',            cls: 'bg-text-muted/10 text-text-sec border-text-muted' },
};

export default function StatusBadge({ status, size = 'sm' }) {
  const cfg = configs[status] || { label: status, cls: 'bg-text-muted/10 text-text-sec border-text-muted' };
  const sz  = size === 'xs' ? 'text-[10px] px-1.5 py-0.5 border' : 'text-xs px-2 py-1 border-2';
  return (
    <span className={`inline-flex items-center font-pixel tracking-wider uppercase ${sz} ${cfg.cls} shadow-[1px_1px_0_0_#000]`}>
      {cfg.label}
    </span>
  );
}
