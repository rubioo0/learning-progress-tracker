/**
 * Comprehensive error handling utilities for time tracking functionality
 * Provides consistent error handling, logging, and user-friendly messages
 */

class TimeTrackingError extends Error {
    constructor(message, code, statusCode = 500, details = {}) {
        super(message);
        this.name = 'TimeTrackingError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }
}

class ErrorHandler {
    constructor() {
        this.errorCodes = {
            // Session management errors
            SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
            SESSION_ALREADY_ACTIVE: 'SESSION_ALREADY_ACTIVE',
            SESSION_INVALID_STATE: 'SESSION_INVALID_STATE',
            SESSION_TIMEOUT: 'SESSION_TIMEOUT',
            
            // Database errors
            DATABASE_CONNECTION_ERROR: 'DATABASE_CONNECTION_ERROR',
            DATABASE_QUERY_ERROR: 'DATABASE_QUERY_ERROR',
            DATABASE_CONSTRAINT_ERROR: 'DATABASE_CONSTRAINT_ERROR',
            
            // Network errors
            NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
            NETWORK_CONNECTION_ERROR: 'NETWORK_CONNECTION_ERROR',
            
            // Validation errors
            INVALID_INPUT: 'INVALID_INPUT',
            INVALID_SESSION_ID: 'INVALID_SESSION_ID',
            INVALID_USER_ID: 'INVALID_USER_ID',
            INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
            
            // Rate limiting
            RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
            TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
            
            // System errors
            INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
            SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
            INSUFFICIENT_STORAGE: 'INSUFFICIENT_STORAGE'
        };

        this.userFriendlyMessages = {
            [this.errorCodes.SESSION_NOT_FOUND]: 'No active learning session found. Please start a new session.',
            [this.errorCodes.SESSION_ALREADY_ACTIVE]: 'You already have an active learning session. Please stop it before starting a new one.',
            [this.errorCodes.SESSION_INVALID_STATE]: 'The learning session is in an invalid state. Please refresh and try again.',
            [this.errorCodes.SESSION_TIMEOUT]: 'Your learning session has timed out. Please start a new session.',
            [this.errorCodes.DATABASE_CONNECTION_ERROR]: 'Unable to connect to the database. Please try again later.',
            [this.errorCodes.DATABASE_QUERY_ERROR]: 'A database error occurred. Please try again.',
            [this.errorCodes.NETWORK_TIMEOUT]: 'The request timed out. Please check your connection and try again.',
            [this.errorCodes.NETWORK_CONNECTION_ERROR]: 'Network connection error. Please check your internet connection.',
            [this.errorCodes.INVALID_INPUT]: 'Invalid input provided. Please check your data and try again.',
            [this.errorCodes.RATE_LIMIT_EXCEEDED]: 'Too many requests. Please wait a moment before trying again.',
            [this.errorCodes.INTERNAL_SERVER_ERROR]: 'An internal error occurred. Please try again later.',
            [this.errorCodes.SERVICE_UNAVAILABLE]: 'Service temporarily unavailable. Please try again later.'
        };

        // Request tracking for rate limiting
        this.requestCounts = new Map();
        this.rateLimitWindow = 60000; // 1 minute
        this.maxRequestsPerWindow = 100;

        // Cleanup old request counts every 5 minutes
        setInterval(() => this.cleanupRequestCounts(), 5 * 60000);
    }

    /**
     * Create a new TimeTrackingError
     * @param {string} message - Error message
     * @param {string} code - Error code
     * @param {number} statusCode - HTTP status code
     * @param {Object} details - Additional error details
     * @returns {TimeTrackingError}
     */
    createError(message, code, statusCode = 500, details = {}) {
        return new TimeTrackingError(message, code, statusCode, details);
    }

    /**
     * Handle and format errors for API responses
     * @param {Error} error - The error to handle
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    handleError(error, req, res, next) {
        // Log the error for debugging
        this.logError(error, req);

        // Check if it's our custom error
        if (error instanceof TimeTrackingError) {
            return res.status(error.statusCode).json({
                success: false,
                error: {
                    code: error.code,
                    message: this.getUserFriendlyMessage(error.code) || error.message,
                    details: error.details,
                    timestamp: error.timestamp
                }
            });
        }

        // Handle known error types
        const handledError = this.categorizeError(error);
        
        res.status(handledError.statusCode).json({
            success: false,
            error: {
                code: handledError.code,
                message: this.getUserFriendlyMessage(handledError.code) || 'An unexpected error occurred',
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Categorize unknown errors into known error types
     * @param {Error} error - The error to categorize
     * @returns {Object} Categorized error
     */
    categorizeError(error) {
        const message = error.message.toLowerCase();

        // Database errors
        if (message.includes('database') || message.includes('sqlite') || message.includes('enoent')) {
            return {
                code: this.errorCodes.DATABASE_CONNECTION_ERROR,
                statusCode: 503
            };
        }

        if (message.includes('constraint') || message.includes('unique')) {
            return {
                code: this.errorCodes.DATABASE_CONSTRAINT_ERROR,
                statusCode: 409
            };
        }

        // Network errors
        if (message.includes('timeout') || message.includes('etimedout')) {
            return {
                code: this.errorCodes.NETWORK_TIMEOUT,
                statusCode: 408
            };
        }

        if (message.includes('econnrefused') || message.includes('network')) {
            return {
                code: this.errorCodes.NETWORK_CONNECTION_ERROR,
                statusCode: 503
            };
        }

        // Validation errors
        if (message.includes('invalid') || message.includes('validation')) {
            return {
                code: this.errorCodes.INVALID_INPUT,
                statusCode: 400
            };
        }

        // Default to internal server error
        return {
            code: this.errorCodes.INTERNAL_SERVER_ERROR,
            statusCode: 500
        };
    }

    /**
     * Get user-friendly message for error code
     * @param {string} code - Error code
     * @returns {string} User-friendly message
     */
    getUserFriendlyMessage(code) {
        return this.userFriendlyMessages[code] || 'An unexpected error occurred. Please try again.';
    }

    /**
     * Log error with context information
     * @param {Error} error - The error to log
     * @param {Object} req - Express request object (optional)
     */
    logError(error, req = null) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
                code: error.code || 'UNKNOWN'
            }
        };

        if (req) {
            logEntry.request = {
                method: req.method,
                url: req.url,
                userAgent: req.get('User-Agent'),
                ip: req.ip || req.connection.remoteAddress,
                body: this.sanitizeRequestBody(req.body),
                params: req.params,
                query: req.query
            };
        }

        // In production, you might want to send this to a logging service
        console.error('Time Tracking Error:', JSON.stringify(logEntry, null, 2));
    }

    /**
     * Sanitize request body for logging (remove sensitive data)
     * @param {Object} body - Request body
     * @returns {Object} Sanitized body
     */
    sanitizeRequestBody(body) {
        if (!body || typeof body !== 'object') return body;

        const sanitized = { ...body };
        const sensitiveFields = ['password', 'token', 'secret', 'apiKey'];
        
        sensitiveFields.forEach(field => {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        });

        return sanitized;
    }

    /**
     * Validate session ID format
     * @param {string} sessionId - Session ID to validate
     * @returns {boolean} Whether the session ID is valid
     */
    validateSessionId(sessionId) {
        if (!sessionId || typeof sessionId !== 'string') {
            return false;
        }

        // Check if it matches our session ID format
        const sessionIdPattern = /^session_\d+_[a-z0-9]{9}$/;
        return sessionIdPattern.test(sessionId);
    }

    /**
     * Validate user ID format
     * @param {string} userId - User ID to validate
     * @returns {boolean} Whether the user ID is valid
     */
    validateUserId(userId) {
        if (!userId || typeof userId !== 'string') {
            return false;
        }

        // Basic validation - alphanumeric and underscores, 1-50 characters
        const userIdPattern = /^[a-zA-Z0-9_]{1,50}$/;
        return userIdPattern.test(userId);
    }

    /**
     * Validate timestamp format
     * @param {string} timestamp - Timestamp to validate
     * @returns {boolean} Whether the timestamp is valid
     */
    validateTimestamp(timestamp) {
        if (!timestamp || typeof timestamp !== 'string') {
            return false;
        }

        const date = new Date(timestamp);
        return !isNaN(date.getTime()) && date.toISOString() === timestamp;
    }

    /**
     * Check rate limiting for requests
     * @param {string} identifier - Request identifier (IP, user ID, etc.)
     * @returns {boolean} Whether the request should be allowed
     */
    checkRateLimit(identifier) {
        const now = Date.now();
        const windowStart = now - this.rateLimitWindow;

        if (!this.requestCounts.has(identifier)) {
            this.requestCounts.set(identifier, []);
        }

        const requests = this.requestCounts.get(identifier);
        
        // Remove old requests outside the window
        const validRequests = requests.filter(timestamp => timestamp > windowStart);
        
        // Check if under limit
        if (validRequests.length >= this.maxRequestsPerWindow) {
            return false;
        }

        // Add current request
        validRequests.push(now);
        this.requestCounts.set(identifier, validRequests);
        
        return true;
    }

    /**
     * Clean up old request counts to prevent memory leaks
     */
    cleanupRequestCounts() {
        const now = Date.now();
        const cutoff = now - this.rateLimitWindow;

        for (const [identifier, requests] of this.requestCounts.entries()) {
            const validRequests = requests.filter(timestamp => timestamp > cutoff);
            
            if (validRequests.length === 0) {
                this.requestCounts.delete(identifier);
            } else {
                this.requestCounts.set(identifier, validRequests);
            }
        }
    }

    /**
     * Create middleware for rate limiting
     * @returns {Function} Express middleware function
     */
    rateLimitMiddleware() {
        return (req, res, next) => {
            const identifier = req.ip || req.connection.remoteAddress || 'unknown';
            
            if (!this.checkRateLimit(identifier)) {
                const error = this.createError(
                    'Rate limit exceeded',
                    this.errorCodes.RATE_LIMIT_EXCEEDED,
                    429,
                    { identifier, limit: this.maxRequestsPerWindow, window: this.rateLimitWindow }
                );
                
                return this.handleError(error, req, res, next);
            }

            next();
        };
    }

    /**
     * Create middleware for input validation
     * @param {Object} schema - Validation schema
     * @returns {Function} Express middleware function
     */
    validationMiddleware(schema) {
        return (req, res, next) => {
            const errors = this.validateInput(req.body, schema);
            
            if (errors.length > 0) {
                const error = this.createError(
                    'Input validation failed',
                    this.errorCodes.INVALID_INPUT,
                    400,
                    { validationErrors: errors }
                );
                
                return this.handleError(error, req, res, next);
            }

            next();
        };
    }

    /**
     * Validate input against schema
     * @param {Object} data - Data to validate
     * @param {Object} schema - Validation schema
     * @returns {Array} Array of validation errors
     */
    validateInput(data, schema) {
        const errors = [];

        for (const [field, rules] of Object.entries(schema)) {
            const value = data[field];

            if (rules.required && (value === undefined || value === null || value === '')) {
                errors.push(`Field '${field}' is required`);
                continue;
            }

            if (value !== undefined && value !== null) {
                if (rules.type && typeof value !== rules.type) {
                    errors.push(`Field '${field}' must be of type ${rules.type}`);
                }

                if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
                    errors.push(`Field '${field}' must be at least ${rules.minLength} characters`);
                }

                if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
                    errors.push(`Field '${field}' must be no more than ${rules.maxLength} characters`);
                }

                if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
                    errors.push(`Field '${field}' format is invalid`);
                }

                if (rules.validate && typeof rules.validate === 'function') {
                    const customError = rules.validate(value);
                    if (customError) {
                        errors.push(`Field '${field}': ${customError}`);
                    }
                }
            }
        }

        return errors;
    }

    /**
     * Retry function with exponential backoff
     * @param {Function} fn - Function to retry
     * @param {number} maxRetries - Maximum number of retries
     * @param {number} baseDelay - Base delay in milliseconds
     * @returns {Promise} Promise that resolves with the function result
     */
    async retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                
                if (attempt === maxRetries) {
                    break;
                }

                const delay = baseDelay * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }
}

// Create singleton instance
const errorHandler = new ErrorHandler();

module.exports = {
    ErrorHandler,
    TimeTrackingError,
    errorHandler
};
