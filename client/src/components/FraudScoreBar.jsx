export default function FraudScoreBar({ score=0 }){
  const color = score < 40 ? 'bg-green-400' : score < 70 ? 'bg-amber-400' : 'bg-red-500'
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-sm">
        <div className="font-medium">{score}</div>
        <div className="text-[var(--text-secondary)] text-xs">/ 100</div>
      </div>
      <div className="w-full h-2 bg-[#111118] rounded mt-2">
        <div className={`${color} h-2 rounded`} style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
      </div>
    </div>
  )
}
