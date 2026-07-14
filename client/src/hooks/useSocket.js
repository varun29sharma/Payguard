import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../api/socket';

// Uses the single shared, authenticated socket connection (api/socket.js)
// instead of opening a new one per component.
export const useSocket = () => {
  const socketRef  = useRef(getSocket());
  const [connected, setConnected] = useState(socketRef.current.connected);

  useEffect(() => {
    const s = socketRef.current;
    s.on('connect',    () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    return () => { s.off('connect'); s.off('disconnect'); };
  }, []);

  return { socket: socketRef.current, connected };
};
