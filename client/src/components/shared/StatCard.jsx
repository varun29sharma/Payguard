import { useCountUp } from '../../hooks/useCountUp';

export default function StatCard({ label, value, accent, icon, sub, trend }) {
  const animated = useCountUp(typeof value === 'number' ? value : 0);

  const accentMap = {
    brand:  'text-ink',
    amber:  'text-amber-600 dark:text-amber-400',
    red:    'text-accent',
    purple: 'text-purple-700 dark:text-purple-400',
    blue:   'text-blue-700 dark:text-blue-400',
  };
  const valueColor = accentMap[accent] || accentMap.brand;

  return (
    <div className="border-t-2 border-ink pt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="label">{label}</div>
        {icon && <span className="text-[13px] font-mono text-muted leading-none">{icon}</span>}
      </div>
      <div className={`text-5xl font-extrabold tracking-tight leading-none ${valueColor}`}>
        {typeof value === 'number' ? animated.toLocaleString() : value}
      </div>
      {sub && <div className="label mt-2">{sub}</div>}
      {trend !== undefined && (
        <div className={`text-[11px] font-mono mt-2 uppercase ${trend > 0 ? 'text-accent' : 'text-ink-soft'}`}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last hr
        </div>
      )}
    </div>
  );
}
