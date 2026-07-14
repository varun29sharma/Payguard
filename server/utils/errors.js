/**
 * Typed application errors. Controllers/services throw these; the global
 * errorHandler middleware (see middleware/errorHandler.js) maps them to the
 * right HTTP status instead of every route hand-rolling try/catch + res.status.
 */
class AppError extends Error {
  constructor(message, statusCode, details) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details) { super(message, 400, details); }
}

class ConflictError extends AppError {
  constructor(message, details) { super(message, 409, details); }
}

class AuthorizationError extends AppError {
  constructor(message, details) { super(message, 403, details); }
}

class FraudRuleError extends AppError {
  constructor(message, details) { super(message, 422, details); }
}

class NotFoundError extends AppError {
  constructor(message, details) { super(message, 404, details); }
}

module.exports = { AppError, ValidationError, ConflictError, AuthorizationError, FraudRuleError, NotFoundError };
