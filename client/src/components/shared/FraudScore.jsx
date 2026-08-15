export default function FraudScore({ score, showBar = false }) {
  const color = score >= 70 ? 'text-accent' : score >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-ink';
  const barColor = score >= 70 ? 'bg-accent' : score >= 40 ? 'bg-amber-500' : 'bg-ink';

  if (!showBar) {
    return <span className={`font-mono text-base font-semibold tabular-nums ${color}`}>{score}</span>;
  }

  return (
    <div className="flex items-center gap-3">
      <span className={`font-mono text-sm font-semibold tabular-nums w-6 text-right ${color}`}>{score}</span>
      <div className="flex-1 max-w-[90px] h-[3px] bg-hairline">
        <div
          className={`h-full transition-all duration-700 ${barColor}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}
