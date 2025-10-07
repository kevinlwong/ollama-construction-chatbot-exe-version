/**
 * Input validation schemas for RAG and security operations
 */

import Joi from 'joi';

/**
 * Validation schema for document upload
 */
export const documentUploadSchema = Joi.object({
  project_id: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .min(1)
    .max(50)
    .required()
    .messages({
      'string.pattern.base': 'Project ID must contain only letters, numbers, hyphens, and underscores',
      'string.min': 'Project ID must be at least 1 character long',
      'string.max': 'Project ID must be no more than 50 characters long'
    }),
  
  project_name: Joi.string()
    .min(1)
    .max(100)
    .optional(),
    
  description: Joi.string()
    .max(500)
    .optional(),
    
  tags: Joi.array()
    .items(Joi.string().max(30))
    .max(10)
    .optional()
});

/**
 * Validation schema for chat input
 */
export const chatInputSchema = Joi.object({
  message: Joi.string()
    .min(1)
    .max(2000)
    .required()
    .messages({
      'string.min': 'Message cannot be empty',
      'string.max': 'Message must be no more than 2000 characters'
    }),
    
  model: Joi.string()
    .pattern(/^[a-zA-Z0-9_:-]+$/)
    .required()
    .messages({
      'string.pattern.base': 'Invalid model name format'
    }),
    
  project_id: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .optional(),
    
  context_limit: Joi.number()
    .integer()
    .min(1)
    .max(10)
    .default(5)
    .optional()
});

/**
 * Validation schema for project creation
 */
export const projectSchema = Joi.object({
  id: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .min(1)
    .max(50)
    .required(),
    
  name: Joi.string()
    .min(1)
    .max(100)
    .required(),
    
  description: Joi.string()
    .max(500)
    .optional(),
    
  active: Joi.boolean()
    .default(true),
    
  tags: Joi.array()
    .items(Joi.string().max(30))
    .max(10)
    .optional(),
    
  metadata: Joi.object()
    .pattern(Joi.string(), Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()))
    .optional()
});

/**
 * Validation schema for chunking options
 */
export const chunkingOptionsSchema = Joi.object({
  chunkSize: Joi.number()
    .integer()
    .min(100)
    .max(2000)
    .default(500),
    
  overlap: Joi.number()
    .integer()
    .min(0)
    .max(500)
    .default(50),
    
  separator: Joi.string()
    .valid('sentence', 'paragraph', 'words')
    .default('sentence')
});

/**
 * Validation schema for search queries
 */
export const searchQuerySchema = Joi.object({
  query: Joi.string()
    .min(1)
    .max(1000)
    .required(),
    
  project_id: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .optional(),
    
  limit: Joi.number()
    .integer()
    .min(1)
    .max(20)
    .default(5),
    
  threshold: Joi.number()
    .min(0)
    .max(1)
    .default(0.1),
    
  include_metadata: Joi.boolean()
    .default(false)
});

/**
 * Security validation patterns
 */
export const securityPatterns = {
  // Injection attempt patterns
  injectionKeywords: [
    'ignore', 'forget', 'disregard', 'override', 'bypass', 'disable',
    'reveal', 'show', 'display', 'output', 'print', 'echo',
    'system', 'prompt', 'instruction', 'directive', 'command',
    'admin', 'root', 'developer', 'debug', 'config'
  ],
  
  // Instruction override patterns
  instructionOverride: [
    /ignore\s+(previous|all|above|system|instructions)/i,
    /forget\s+(everything|instructions|context|previous)/i,
    /new\s+(instructions|task|role|directive)/i,
    /override\s+(instructions|system|previous)/i,
    /disregard\s+(instructions|system|previous)/i
  ],
  
  // System extraction patterns
  systemExtraction: [
    /show\s+(prompt|instructions|system|directive)/i,
    /reveal\s+(your|the)\s+(prompt|instructions|system)/i,
    /what\s+(are\s+)?your\s+(instructions|prompt|system)/i,
    /display\s+(system|instructions|prompt)/i,
    /output\s+(system|instructions|prompt)/i
  ],
  
  // Role confusion patterns
  roleConfusion: [
    /you\s+are\s+now/i,
    /act\s+as\s+if/i,
    /pretend\s+(to\s+be|you\s+are)/i,
    /imagine\s+you\s+are/i,
    /from\s+now\s+on/i
  ]
};

/**
 * Validate input against security patterns
 * @param {string} input - User input to validate
 * @returns {Object} Validation result
 */
export function validateSecurity(input) {
  if (!input || typeof input !== 'string') {
    return { valid: true, threats: [] };
  }

  const threats = [];
  const lowerInput = input.toLowerCase();

  // Check for injection keywords
  const foundKeywords = securityPatterns.injectionKeywords.filter(keyword => 
    lowerInput.includes(keyword.toLowerCase())
  );
  
  if (foundKeywords.length > 0) {
    threats.push({
      type: 'injection_keywords',
      severity: 'medium',
      keywords: foundKeywords
    });
  }

  // Check instruction override patterns
  for (const pattern of securityPatterns.instructionOverride) {
    if (pattern.test(input)) {
      threats.push({
        type: 'instruction_override',
        severity: 'high',
        pattern: pattern.toString()
      });
    }
  }

  // Check system extraction patterns
  for (const pattern of securityPatterns.systemExtraction) {
    if (pattern.test(input)) {
      threats.push({
        type: 'system_extraction',
        severity: 'high',
        pattern: pattern.toString()
      });
    }
  }

  // Check role confusion patterns
  for (const pattern of securityPatterns.roleConfusion) {
    if (pattern.test(input)) {
      threats.push({
        type: 'role_confusion',
        severity: 'medium',
        pattern: pattern.toString()
      });
    }
  }

  // Calculate overall risk score
  const riskScore = threats.reduce((score, threat) => {
    switch (threat.severity) {
      case 'high': return score + 3;
      case 'medium': return score + 2;
      case 'low': return score + 1;
      default: return score;
    }
  }, 0);

  return {
    valid: riskScore < 5, // Threshold for blocking
    threats,
    riskScore,
    recommendation: riskScore >= 5 ? 'block' : riskScore >= 2 ? 'warn' : 'allow'
  };
}

/**
 * Sanitize user input by removing potentially dangerous content
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized input
 */
export function sanitizeInput(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove common injection markers
  let sanitized = input
    .replace(/<!--.*?-->/g, '') // HTML comments
    .replace(/<script.*?<\/script>/gi, '') // Script tags
    .replace(/javascript:/gi, '') // JavaScript protocols
    .replace(/on\w+\s*=/gi, '') // Event handlers
    .trim();

  // Limit length
  if (sanitized.length > 2000) {
    sanitized = sanitized.substring(0, 2000) + '...';
  }

  return sanitized;
}

/**
 * Validate file upload constraints
 * @param {Object} file - File object
 * @returns {Object} Validation result
 */
export function validateFileUpload(file) {
  const errors = [];
  const allowedTypes = ['.pdf', '.docx', '.txt', '.png', '.jpg', '.jpeg'];
  const maxSize = 50 * 1024 * 1024; // 50MB

  if (!file) {
    errors.push('No file provided');
    return { valid: false, errors };
  }

  // Check file size
  if (file.size > maxSize) {
    errors.push('File size exceeds 50MB limit');
  }

  // Check file type
  const ext = file.originalname ? 
    file.originalname.toLowerCase().split('.').pop() : '';
  
  if (!allowedTypes.includes(`.${ext}`)) {
    errors.push(`File type .${ext} not allowed. Allowed types: ${allowedTypes.join(', ')}`);
  }

  // Check filename for dangerous patterns
  if (file.originalname && /[<>:"|?*]/.test(file.originalname)) {
    errors.push('Filename contains invalid characters');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Rate limiting validation
 * @param {string} identifier - Request identifier (IP, user ID, etc.)
 * @param {number} limit - Request limit per window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Object} Rate limit result
 */
export function validateRateLimit(identifier, limit = 10, windowMs = 60000) {
  // Simple in-memory rate limiting (can be enhanced with Redis later)
  if (!global.rateLimitStore) {
    global.rateLimitStore = new Map();
  }

  const now = Date.now();
  const key = `${identifier}:${Math.floor(now / windowMs)}`;
  
  const current = global.rateLimitStore.get(key) || 0;
  
  if (current >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: Math.ceil(now / windowMs) * windowMs,
      retryAfter: Math.ceil((Math.ceil(now / windowMs) * windowMs - now) / 1000)
    };
  }

  global.rateLimitStore.set(key, current + 1);
  
  // Cleanup old entries
  for (const [storeKey] of global.rateLimitStore.entries()) {
    const keyTime = parseInt(storeKey.split(':')[1]) * windowMs;
    if (now - keyTime > windowMs * 2) {
      global.rateLimitStore.delete(storeKey);
    }
  }

  return {
    allowed: true,
    remaining: limit - current - 1,
    resetTime: Math.ceil(now / windowMs) * windowMs,
    retryAfter: 0
  };
}