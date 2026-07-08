export default function FraudScore({ score, showBar = false }) {
  const color = score >= 70 ? 'text-red-400'
              : score >= 40 ? 'text-amber-400'
              : 'text-green-400';
  const barColor = score >= 70 ? 'bg-red-500'
                 : score >= 40 ? 'bg-amber-500'
                 : 'bg-green-500';

  return (
    <div className="flex items-center gap-2">
      <span className={`font-mono font-semibold text-sm ${color}`}>{score}</span>
      {showBar && (
        <div className="w-16 h-1.5 bg-border-dim rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${score}%` }}
          />
        </div>
      )}
    </div>
  );
}
