/**
 * Security middleware for RAG system
 */

import promptGuard from '../services/promptGuard.js';
import { validateRateLimit } from '../utils/validation.js';
import logger from '../utils/logger.js';

/**
 * Rate limiting middleware
 * @param {Object} options - Rate limiting options
 * @returns {Function} Express middleware
 */
export const rateLimiter = (options = {}) => {
  const { limit = 10, windowMs = 60000, message = 'Too many requests' } = options;
  
  return (req, res, next) => {
    const identifier = req.ip || req.connection.remoteAddress || 'unknown';
    const rateLimit = validateRateLimit(identifier, limit, windowMs);
    
    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': limit,
      'X-RateLimit-Remaining': rateLimit.remaining,
      'X-RateLimit-Reset': new Date(rateLimit.resetTime).toISOString()
    });
    
    if (!rateLimit.allowed) {
      logger.logSecurity('rate_limit_exceeded', {
        ip: identifier,
        limit,
        windowMs,
        retryAfter: rateLimit.retryAfter
      }, 'medium');
      
      res.set('Retry-After', rateLimit.retryAfter);
      return res.status(429).json({
        error: message,
        retryAfter: rateLimit.retryAfter
      });
    }
    
    next();
  };
};

/**
 * Prompt injection protection middleware
 * @param {Object} options - Security options
 * @returns {Function} Express middleware
 */
export const promptSecurity = (options = {}) => {
  const { field = 'message', required = true } = options;
  
  return async (req, res, next) => {
    try {
      const input = req.body[field];
      
      // Check if field is required
      if (required && (!input || typeof input !== 'string' || input.trim().length === 0)) {
        return res.status(400).json({
          error: `Field '${field}' is required and cannot be empty`
        });
      }
      
      // Skip security check if no input
      if (!input) {
        return next();
      }
      
      // Prepare context for security check
      const context = {
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        identifier: req.ip || 'unknown',
        endpoint: req.path,
        method: req.method
      };
      
      // Perform security check
      const securityResult = await promptGuard.checkSecurity(input, context);
      
      if (!securityResult.allowed) {
        // Log the blocked attempt
        logger.logSecurity('prompt_injection_blocked', {
          input: input.substring(0, 200),
          threats: securityResult.threats,
          context
        }, 'high');
        
        return res.status(400).json({
          error: 'Input rejected for security reasons',
          reason: securityResult.reason || 'Potentially harmful content detected',
          action: securityResult.action
        });
      }
      
      // Log warnings but allow request
      if (securityResult.action === 'warn') {
        logger.logSecurity('prompt_injection_warning', {
          input: input.substring(0, 200),
          threats: securityResult.threats,
          context
        }, 'medium');
      }
      
      // Attach security result to request for downstream use
      req.securityCheck = securityResult;
      
      // Replace input with sanitized version if applicable
      if (securityResult.sanitizedInput && securityResult.sanitizedInput !== input) {
        req.body[field] = securityResult.sanitizedInput;
        req.inputSanitized = true;
      }
      
      next();
      
    } catch (error) {
      logger.logSecurity('security_middleware_error', {
        error: error.message,
        field,
        endpoint: req.path
      }, 'high');
      
      // Fail securely - block request on security middleware error
      return res.status(500).json({
        error: 'Security check failed'
      });
    }
  };
};

/**
 * File upload security middleware
 * @param {Object} options - Upload security options
 * @returns {Function} Express middleware
 */
export const uploadSecurity = (options = {}) => {
  const { 
    maxSize = 50 * 1024 * 1024, // 50MB
    allowedTypes = ['.pdf', '.docx', '.txt', '.png', '.jpg', '.jpeg'],
    maxFiles = 1 
  } = options;
  
  return (req, res, next) => {
    try {
      // Check if file was uploaded
      if (!req.file && !req.files) {
        return next();
      }
      
      const files = req.files || [req.file];
      
      // Check file count
      if (files.length > maxFiles) {
        return res.status(400).json({
          error: `Maximum ${maxFiles} file(s) allowed`
        });
      }
      
      // Validate each file
      for (const file of files) {
        if (!file) continue;
        
        // Check file size
        if (file.size > maxSize) {
          return res.status(400).json({
            error: `File size exceeds limit of ${Math.round(maxSize / (1024 * 1024))}MB`
          });
        }
        
        // Check file type
        const ext = file.originalname ? 
          '.' + file.originalname.toLowerCase().split('.').pop() : '';
        
        if (!allowedTypes.includes(ext)) {
          return res.status(400).json({
            error: `File type ${ext} not allowed. Allowed types: ${allowedTypes.join(', ')}`
          });
        }
        
        // Check filename for dangerous patterns
        if (file.originalname && /[<>:"|?*]/.test(file.originalname)) {
          return res.status(400).json({
            error: 'Filename contains invalid characters'
          });
        }
        
        // Basic content type check
        if (file.mimetype && file.mimetype.includes('script')) {
          return res.status(400).json({
            error: 'Script files are not allowed'
          });
        }
      }
      
      logger.logSecurity('file_upload_validated', {
        fileCount: files.length,
        totalSize: files.reduce((sum, f) => sum + (f?.size || 0), 0),
        fileTypes: files.map(f => f?.originalname?.split('.').pop()).filter(Boolean)
      }, 'low');
      
      next();
      
    } catch (error) {
      logger.logSecurity('upload_security_error', {
        error: error.message,
        endpoint: req.path
      }, 'medium');
      
      return res.status(500).json({
        error: 'File validation failed'
      });
    }
  };
};

/**
 * Request logging middleware
 * @returns {Function} Express middleware
 */
export const requestLogger = () => {
  return (req, res, next) => {
    const startTime = Date.now();
    
    // Log request start
    logger.logRAG('request_start', {
      method: req.method,
      url: req.url,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      contentLength: req.get('Content-Length')
    });
    
    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = Date.now() - startTime;
      
      logger.logRAG('request_complete', {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        contentLength: res.get('Content-Length')
      });
      
      logger.logPerformance('http_request', duration, {
        method: req.method,
        endpoint: req.path,
        statusCode: res.statusCode
      });
      
      originalEnd.apply(this, args);
    };
    
    next();
  };
};

/**
 * Error handling middleware
 * @returns {Function} Express middleware
 */
export const errorHandler = () => {
  return (err, req, res, next) => {
    logger.logRAG('request_error', {
      error: err.message,
      stack: err.stack,
      method: req.method,
      url: req.url,
      ip: req.ip || req.connection.remoteAddress
    }, 'error');
    
    // Don't expose internal errors in production
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    const response = {
      error: 'Internal server error',
      ...(isDevelopment && { details: err.message, stack: err.stack })
    };
    
    res.status(500).json(response);
  };
};

/**
 * CORS and security headers middleware
 * @returns {Function} Express middleware
 */
export const securityHeaders = () => {
  return (req, res, next) => {
    // Basic security headers
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    
    next();
  };
};