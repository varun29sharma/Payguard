import { useState, useEffect, useRef } from 'react';

export const useCountUp = (target, duration = 1200) => {
  const [value, setValue] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    if (target === prev.current) return;
    const start   = prev.current;
    const diff    = target - start;
    const startTs = performance.now();

    const tick = (now) => {
      const elapsed = now - startTs;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(start + diff * eased));
      if (progress < 1) requestAnimationFrame(tick);
      else { prev.current = target; }
    };

    requestAnimationFrame(tick);
  }, [target, duration]);

  return value;
};
