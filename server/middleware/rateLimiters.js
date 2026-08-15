/**
 * rateLimiters.js — per-IP request throttles.
 *
 * authLimiter  — strict, for /api/auth/login + /api/auth/register: the classic
 *                brute-force surface (credential stuffing / password guessing).
 *                ​20 attempts per 15 min is a deliberate low ceiling.
 * apiLimiter   — generous backstop for the whole /api surface so an
 *                unauthenticated flood (or a misbehaving client) can't pin the
 *                process. Kept far above legitimate usage: the dashboard polls
 *                ~once per 15s and the simulator bursts a few dozen txns.
 */
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts — try again in a few minutes.' },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests — slow down.' },
});

module.exports = { authLimiter, apiLimiter };
