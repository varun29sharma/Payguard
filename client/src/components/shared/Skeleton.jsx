export function SkeletonRow({ cols = 5 }) {
  return (
    <tr className="border-b border-border-dim">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-border-mid animate-pulse-fast border border-border-hi" style={{ width: `${40 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard() {
  return (
    <div className="pixel-box p-5 border-border-mid">
      <div className="h-4 w-24 bg-border-mid animate-pulse-fast border border-border-hi mb-4" />
      <div className="h-8 w-16 bg-border-mid animate-pulse-fast border border-border-hi mb-2" />
      <div className="h-3 w-32 bg-border-mid animate-pulse-fast border border-border-hi" />
    </div>
  );
}

export function SkeletonAlertCard() {
  return (
    <div className="pixel-box p-5 border-border-mid">
      <div className="flex justify-between mb-4">
        <div className="h-5 w-40 bg-border-mid animate-pulse-fast border border-border-hi" />
        <div className="h-6 w-20 bg-border-mid animate-pulse-fast border border-border-hi" />
      </div>
      <div className="h-4 w-48 bg-border-mid animate-pulse-fast border border-border-hi mb-2" />
      <div className="h-4 w-32 bg-border-mid animate-pulse-fast border border-border-hi mb-5" />
      <div className="flex gap-3">
        <div className="h-8 w-24 bg-border-mid animate-pulse-fast border border-border-hi" />
        <div className="h-8 w-24 bg-border-mid animate-pulse-fast border border-border-hi" />
      </div>
    </div>
  );
}
