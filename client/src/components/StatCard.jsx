import { useEffect, useRef, useState } from 'react'

export default function StatCard({ title, value=0, topColor='bg-brand' }){
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);

  useEffect(()=>{
    const duration = 1200;
    const start = performance.now();
    const from = 0;
    const to = Number(value) || 0;

    function step(now){
      const t = Math.min(1, (now - start)/duration);
      const eased = t;
      const current = Math.floor(from + (to - from) * eased);
      setDisplay(current);
      if(t < 1) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return ()=> cancelAnimationFrame(rafRef.current);
  },[value]);

  return (
    <div className="card p-4">
      <div className={`h-1 rounded-t-md ${topColor} mb-3`} />
      <div className="text-sm text-[var(--text-secondary)]">{title}</div>
      <div className="text-2xl font-semibold mt-2">{display}</div>
    </div>
  )
}
