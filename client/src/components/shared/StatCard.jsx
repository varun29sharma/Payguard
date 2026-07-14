import { useCountUp } from '../../hooks/useCountUp';

export default function StatCard({ label, value, accent, icon, sub, trend }) {
  const animated = useCountUp(typeof value === 'number' ? value : 0);

  const accentMap = {
    brand:  { border: 'border-brand',     text: 'text-brand',      bg: 'bg-brand-dim' },
    amber:  { border: 'border-amber-500', text: 'text-amber-400',  bg: 'bg-amber-500/10' },
    red:    { border: 'border-red-500',   text: 'text-red-400',    bg: 'bg-red-500/10' },
    purple: { border: 'border-purple-500',text: 'text-purple-400', bg: 'bg-purple-500/10' },
    blue:   { border: 'border-blue-500',  text: 'text-blue-400',   bg: 'bg-blue-500/10' },
  };
  const a = accentMap[accent] || accentMap.brand;

  return (
    <div className={`pixel-box p-4 border-2 ${a.border} relative group overflow-hidden`}>
      <div className={`absolute top-0 right-0 w-8 h-8 ${a.bg} border-b-2 border-l-2 ${a.border} flex items-center justify-center font-vt text-lg`}>
        {icon || '+'}
      </div>
      
      <div className="text-sm font-pixel text-text-sec uppercase tracking-widest mb-4 pr-6">
        {label}
      </div>
      <div className={`text-4xl font-vt ${a.text} text-shadow-pixel mb-1`}>
        {typeof value === 'number' ? animated.toLocaleString() : value}
      </div>
      {sub && <div className="text-[10px] font-mono text-text-muted uppercase">{sub}</div>}
      {trend !== undefined && (
        <div className={`text-[10px] font-mono mt-2 ${trend > 0 ? 'text-red-400' : 'text-brand'}`}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last hr
        </div>
      )}
    </div>
  );
}
