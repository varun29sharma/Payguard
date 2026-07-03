export default function StatusBadge({ status }){
  const map = {
    clear: 'bg-green-600 text-white',
    review: 'bg-amber-500 text-black',
    blocked: 'bg-red-500 text-white',
    open: 'bg-red-500 text-white',
    resolved: 'bg-green-600 text-white',
    false_positive: 'bg-[gray] text-white'
  }
  const cls = map[status] || 'bg-gray-600 text-white'
  return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${cls}`}>{status}</span>
}
