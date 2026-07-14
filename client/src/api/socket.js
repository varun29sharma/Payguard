import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

// Single shared Socket.IO connection for the whole app. Every page used to
// call `io(SOCKET_URL)` itself, opening a separate connection per page and
// never sending an auth token. Centralizing it here means: one connection,
// and the JWT is always attached so the server's socket auth middleware
// (server/middleware/socketAuth.js) can verify who's listening.
let sharedSocket = null;

export const getSocket = () => {
  if (!sharedSocket) {
    sharedSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      auth: { token: localStorage.getItem('pg_token') || undefined },
    });
  }
  return sharedSocket;
};

// Call after login/logout so the next connection carries the current token.
export const resetSocket = () => {
  if (sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
  }
};
