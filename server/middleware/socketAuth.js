const jwt = require('jsonwebtoken');

/**
 * Verifies the JWT passed by the client as `socket.handshake.auth.token`.
 * Sockets that present no token stay anonymous (socket.user = null) so the
 * app doesn't hard-break for any client that hasn't been updated yet, but a
 * token that IS present must be valid — forged/expired tokens are rejected
 * outright instead of silently being treated as anonymous.
 */
const socketAuthMiddleware = (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    socket.user = null;
    return next();
  }
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    next(new Error('Unauthorized socket connection'));
  }
};

module.exports = { socketAuthMiddleware };
