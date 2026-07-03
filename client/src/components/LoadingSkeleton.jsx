export default function LoadingSkeleton({ lines=3 }){
  return (
    <div className="space-y-3">
      {Array.from({length: lines}).map((_,i)=> (
        <div key={i} className="shimmer-bg h-12 rounded-md w-full" />
      ))}
    </div>
  )
}
