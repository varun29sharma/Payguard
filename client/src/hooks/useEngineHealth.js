import { useState, useEffect, useRef } from 'react';
import api from '../api/axiosConfig';
import { getSocket } from '../api/socket';

/**
 * Live view of the Java fraud engine's health + scoring-fallback state.
 *
 * The backend polls /api/fraud/health and emits 'engine-health' socket events
 * whenever availability changes; this hook also polls /api/system/health as a
 * recovery path (e.g. the socket reconnects while the engine state changed).
 * Returns:
 *   { up, latencyMs, rules, checkedAt, lastFallbackAt, fallbackCount, mode }
 * where mode is 'engine' (scoring on the real engine), 'fallback' (engine
 * down, everything scored as clear), or 'checking' (unknown yet).
 */
export default function useEngineHealth(pollMs = 15000) {
  const [health, setHealth] = useState({
    up: null,
    latencyMs: null,
    rules: [],
    checkedAt: null,
    lastFallbackAt: null,
    fallbackCount: 0,
  });
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const fetchHealth = async () => {
      try {
        const { data } = await api.get('/system/health');
        if (!cancelled && data?.engine) {
          setHealth(prev => ({ ...prev, ...data.engine }));
        }
    } catch { /* node server unreachable — keep last known state */ }
    };

    fetchHealth();
    timerRef.current = setInterval(fetchHealth, pollMs);

    const s = getSocket();
    const handleEngineHealth = (h) => {
      if (h) setHealth(prev => ({ ...prev, ...h }));
    };
    s.on('engine-health', handleEngineHealth);

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      s.off('engine-health', handleEngineHealth);
    };
  }, [pollMs]);

  const mode = health.up === null ? 'checking' : (health.up ? 'engine' : 'fallback');
  return { ...health, mode };
}
