import { useCountUp } from '../../hooks/useCountUp';

export default function StatCard({ label, value, accent, icon, sub, trend }) {
  const animated = useCountUp(typeof value === 'number' ? value : 0);

  const accentMap = {
    teal:   { border: 'border-t-brand',     text: 'text-brand',      glow: 'shadow-[0_0_15px_rgba(0,212,184,0.1)]' },
    amber:  { border: 'border-t-amber-500', text: 'text-amber-400',  glow: 'shadow-[0_0_15px_rgba(245,158,11,0.08)]' },
    red:    { border: 'border-t-red-500',   text: 'text-red-400',    glow: 'shadow-[0_0_15px_rgba(239,68,68,0.08)]' },
    purple: { border: 'border-t-purple-500',text: 'text-purple-400', glow: 'shadow-[0_0_15px_rgba(168,85,247,0.08)]' },
    blue:   { border: 'border-t-blue-500',  text: 'text-blue-400',   glow: 'shadow-[0_0_15px_rgba(59,130,246,0.08)]' },
  };
  const a = accentMap[accent] || accentMap.teal;

  return (
    <div className={`bg-bg-card border border-border-dim border-t-2 ${a.border} rounded-xl p-5 ${a.glow} transition-all duration-300 hover:border-border-mid`}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs text-text-sec uppercase tracking-widest font-medium">{label}</span>
        {icon && <span className="text-lg opacity-60">{icon}</span>}
      </div>
      <div className={`text-3xl font-bold ${a.text} font-mono`}>
        {typeof value === 'number' ? animated.toLocaleString() : value}
      </div>
      {sub && <div className="text-xs text-text-muted mt-1.5">{sub}</div>}
      {trend !== undefined && (
        <div className={`text-xs mt-1.5 ${trend > 0 ? 'text-red-400' : 'text-green-400'}`}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last hour
        </div>
      )}
    </div>
  );
}
