const configs = {
  clear:          { label: 'Clear',          cls: 'bg-green-500/10 text-green-400 border-green-500/20'  },
  review:         { label: 'Review',         cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20'  },
  blocked:        { label: 'Blocked',        cls: 'bg-red-500/10 text-red-400 border-red-500/20'        },
  open:           { label: 'Open',           cls: 'bg-red-500/10 text-red-400 border-red-500/20'        },
  resolved:       { label: 'Resolved',       cls: 'bg-green-500/10 text-green-400 border-green-500/20'  },
  false_positive: { label: 'False Positive', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20'  },
  escalated:      { label: 'Escalated',      cls: 'bg-purple-500/10 text-purple-400 border-purple-500/20'},
  active:         { label: 'Active',         cls: 'bg-red-500/10 text-red-400 border-red-500/20'        },
  investigating:  { label: 'Investigating',  cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20'  },
  contained:      { label: 'Contained',      cls: 'bg-green-500/10 text-green-400 border-green-500/20'  },
  dismissed:      { label: 'Dismissed',      cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20'  },
  CRITICAL:       { label: 'CRITICAL',       cls: 'bg-red-500/15 text-red-300 border-red-500/30 font-bold'},
  HIGH:           { label: 'HIGH',           cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20'},
  MEDIUM:         { label: 'MEDIUM',         cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20'  },
  LOW:            { label: 'LOW',            cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20'  },
};

export default function StatusBadge({ status, size = 'sm' }) {
  const cfg = configs[status] || { label: status, cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
  const sz  = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <span className={`inline-flex items-center rounded border font-medium tracking-wide ${sz} ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}
