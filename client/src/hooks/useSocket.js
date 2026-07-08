import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

export const useSocket = () => {
  const socketRef  = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

    socketRef.current.on('connect',    () => setConnected(true));
    socketRef.current.on('disconnect', () => setConnected(false));

    return () => { socketRef.current?.disconnect(); };
  }, []);

  return { socket: socketRef.current, connected };
};
