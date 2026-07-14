const { AppError } = require('../utils/errors');

// Wraps an async route/controller so thrown errors and rejected promises
// reach the global error handler instead of crashing the process or being
// silently swallowed by a missing try/catch.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false, error: err.name, message: err.message, details: err.details,
    });
  }

  // Mongoose schema validation
  if (err.name === 'ValidationError' && err.errors) {
    return res.status(400).json({ success: false, error: 'ValidationError', message: err.message });
  }

  // Mongoose CastError (bad ObjectId, etc.)
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, error: 'ValidationError', message: `Invalid ${err.path}: ${err.value}` });
  }

  // Duplicate key (e.g. the partial-unique blocklist index, transactionId)
  if (err.code === 11000) {
    return res.status(409).json({ success: false, error: 'ConflictError', message: 'Duplicate entry', details: err.keyValue });
  }

  // Optimistic-concurrency conflict (two analysts editing the same alert)
  if (err.name === 'VersionError') {
    return res.status(409).json({ success: false, error: 'ConflictError', message: 'This record was changed by someone else — please refresh and retry.' });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false, error: 'InternalError',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
  });
};

module.exports = { asyncHandler, errorHandler };
