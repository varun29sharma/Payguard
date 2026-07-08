export function SkeletonRow({ cols = 5 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3.5 rounded shimmer-bg" style={{ width: `${60 + Math.random() * 30}%` }} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-bg-card border border-border-dim rounded-xl p-5">
      <div className="h-3 w-16 rounded shimmer-bg mb-3" />
      <div className="h-8 w-24 rounded shimmer-bg mb-2" />
      <div className="h-2.5 w-32 rounded shimmer-bg" />
    </div>
  );
}

export function SkeletonAlertCard() {
  return (
    <div className="bg-bg-card border border-border-dim rounded-xl p-5">
      <div className="flex justify-between mb-3">
        <div className="h-4 w-32 rounded shimmer-bg" />
        <div className="h-5 w-16 rounded shimmer-bg" />
      </div>
      <div className="h-3 w-48 rounded shimmer-bg mb-2" />
      <div className="h-3 w-40 rounded shimmer-bg mb-4" />
      <div className="flex gap-2">
        <div className="h-7 w-20 rounded shimmer-bg" />
        <div className="h-7 w-24 rounded shimmer-bg" />
        <div className="h-7 w-20 rounded shimmer-bg" />
      </div>
    </div>
  );
}
