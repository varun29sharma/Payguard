// Deterministic widths (no Math.random at render time) so skeletons stay
// stable across renders and lint stays happy.
const ROW_WIDTHS = [45, 70, 55, 80, 35, 60];

export function SkeletonRow({ cols = 5 }) {
  return (
    <tr className="border-b border-hairline">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 bg-hairline animate-pulse" style={{ width: `${ROW_WIDTHS[i % ROW_WIDTHS.length]}%` }} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard() {
  return (
    <div className="border-t-2 border-ink pt-4">
      <div className="h-3 w-24 bg-hairline animate-pulse mb-3" />
      <div className="h-10 w-16 bg-hairline animate-pulse mb-2" />
      <div className="h-3 w-32 bg-hairline animate-pulse" />
    </div>
  );
}

export function SkeletonAlertCard() {
  return (
    <div className="card p-6">
      <div className="flex justify-between mb-4">
        <div className="h-4 w-40 bg-hairline animate-pulse" />
        <div className="h-5 w-20 bg-hairline animate-pulse" />
      </div>
      <div className="h-3 w-48 bg-hairline animate-pulse mb-2" />
      <div className="h-3 w-32 bg-hairline animate-pulse mb-5" />
      <div className="flex gap-3">
        <div className="h-8 w-24 bg-hairline animate-pulse" />
        <div className="h-8 w-24 bg-hairline animate-pulse" />
      </div>
    </div>
  );
}
