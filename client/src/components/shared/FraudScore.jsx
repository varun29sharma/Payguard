export default function FraudScore({ score, showBar = false }) {
  const color = score >= 70 ? 'text-red-400 border-red-500 bg-red-500/20'
              : score >= 40 ? 'text-amber-400 border-amber-500 bg-amber-500/20'
              : 'text-brand border-brand bg-brand-dim';
              
  const textOnly = score >= 70 ? 'text-red-400' : score >= 40 ? 'text-amber-400' : 'text-brand';

  if (!showBar) {
    return <span className={`font-vt text-lg ${textOnly} text-shadow-pixel`}>{score}</span>;
  }

  return (
    <div className="flex items-center gap-3">
      <div className={`w-8 h-6 border-2 flex items-center justify-center font-vt text-sm ${color} shadow-[1px_1px_0_0_#000]`}>
        {score}
      </div>
      <div className="flex-1 max-w-[80px] h-2 bg-bg-primary border border-border-mid flex">
        <div
          className={`h-full transition-all duration-700 ${score >= 70 ? 'bg-red-500' : score >= 40 ? 'bg-amber-500' : 'bg-brand'}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}
