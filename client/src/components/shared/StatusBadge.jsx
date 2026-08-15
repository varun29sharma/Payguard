const G = 'text-green-700 border-green-300 bg-green-50 dark:text-green-300 dark:border-green-800 dark:bg-green-950/40';
const A = 'text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-800 dark:bg-amber-950/40';
const P = 'text-purple-700 border-purple-300 bg-purple-50 dark:text-purple-300 dark:border-purple-800 dark:bg-purple-950/40';
const O = 'text-orange-700 border-orange-300 bg-orange-50 dark:text-orange-300 dark:border-orange-800 dark:bg-orange-950/40';
const M = 'text-muted border-hairline-strong bg-paper';

const configs = {
  clear:          { label: 'CLEAR',          cls: G },
  review:         { label: 'REVIEW',         cls: A },
  blocked:        { label: 'BLOCKED',        cls: 'text-accent border-accent/40 bg-accent/5' },
  rejected:       { label: 'REJECTED',       cls: 'text-accent border-accent/40 bg-accent/5' },
  open:           { label: 'OPEN',           cls: 'text-accent border-accent/40 bg-accent/5' },
  resolved:       { label: 'RESOLVED',       cls: G },
  false_positive: { label: 'FALSE POS',      cls: M },
  escalated:      { label: 'ESCALATED',      cls: P },
  active:         { label: 'ACTIVE',         cls: 'text-accent border-accent/40 bg-accent/5' },
  investigating:  { label: 'INVESTIGATING',  cls: A },
  contained:      { label: 'CONTAINED',      cls: G },
  dismissed:      { label: 'DISMISSED',      cls: M },
  CRITICAL:       { label: 'CRITICAL',       cls: 'text-accent border-accent/40 bg-accent/5 animate-blink' },
  HIGH:           { label: 'HIGH',           cls: O },
  MEDIUM:         { label: 'MEDIUM',         cls: A },
  LOW:            { label: 'LOW',            cls: M },
};

export default function StatusBadge({ status, size = 'sm' }) {
  const cfg = configs[status] || { label: status, cls: 'text-muted border-hairline-strong bg-paper' };
  const sz  = size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1';
  return (
    <span className={`inline-flex items-center font-mono uppercase tracking-wider border ${sz} ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}
