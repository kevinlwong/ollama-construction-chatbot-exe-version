/**
 * Prompt injection protection service
 * Detects and prevents malicious prompt injection attempts
 */

import { validateSecurity, sanitizeInput } from '../utils/validation.js';
import logger from '../utils/logger.js';

class PromptGuard {
  constructor() {
    this.enabled = true;
    this.strictMode = false; // When true, blocks more aggressively
    this.maxPromptLength = 2000;
    this.suspiciousPatterns = this.initializeSuspiciousPatterns();
    this.recentAttempts = new Map(); // Track recent injection attempts by IP/user
  }

  /**
   * Initialize suspicious patterns for injection detection
   * @returns {Object} Pattern collections
   */
  initializeSuspiciousPatterns() {
    return {
      // Direct instruction override attempts
      instructionOverride: [
        /ignore\s+(previous|all|above|system|instructions)/i,
        /forget\s+(everything|instructions|context|previous)/i,
        /disregard\s+(instructions|system|previous|above)/i,
        /override\s+(instructions|system|previous)/i,
        /new\s+(instructions|task|role|directive|system)/i,
        /different\s+(instructions|task|role)/i,
        /alternative\s+(instructions|task|mode)/i
      ],

      // System information extraction
      systemExtraction: [
        /show\s+(me\s+)?(your\s+)?(prompt|instructions|system|directive)/i,
        /reveal\s+(your\s+)?(prompt|instructions|system)/i,
        /what\s+(are\s+)?(your\s+)?(instructions|prompt|system|rules)/i,
        /display\s+(your\s+)?(system|instructions|prompt)/i,
        /output\s+(your\s+)?(system|instructions|prompt)/i,
        /print\s+(your\s+)?(system|instructions|prompt)/i,
        /echo\s+(your\s+)?(system|instructions|prompt)/i,
        /tell\s+me\s+(your\s+)?(instructions|system|prompt)/i
      ],

      // Role confusion and jailbreaking
      roleConfusion: [
        /you\s+are\s+now\s+(a|an|the)/i,
        /act\s+as\s+(if\s+)?(you\s+are\s+)?(a|an|the)/i,
        /pretend\s+(to\s+be\s+)?(you\s+are\s+)?(a|an|the)/i,
        /imagine\s+(you\s+are\s+)?(a|an|the)/i,
        /from\s+now\s+on\s+(you\s+are|act\s+as|be)/i,
        /roleplay\s+as\s+(a|an|the)/i,
        /simulate\s+(being\s+)?(a|an|the)/i
      ],

      // Developer mode and system bypass
      developerMode: [
        /developer\s+mode/i,
        /debug\s+mode/i,
        /admin\s+mode/i,
        /maintenance\s+mode/i,
        /bypass\s+(security|safety|filter)/i,
        /disable\s+(safety|security|filter)/i,
        /turn\s+off\s+(safety|security|filter)/i,
        /unrestricted\s+mode/i
      ],

      // Suspicious keywords that often appear in injection attempts
      suspiciousKeywords: [
        'jailbreak', 'dan', 'evil', 'harmful', 'uncensored', 'unrestricted',
        'bypass', 'exploit', 'hack', 'crack', 'break', 'disable', 'override',
        'backdoor', 'vulnerability', 'injection', 'payload'
      ],

      // Code injection patterns
      codeInjection: [
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /javascript:/i,
        /vbscript:/i,
        /on\w+\s*=/i,
        /eval\s*\(/i,
        /function\s*\(/i,
        /=>\s*{/,
        /\$\{.*\}/
      ],

      // Prompt continuation patterns
      promptContinuation: [
        /continue\s+(the\s+)?(conversation|chat|prompt)/i,
        /keep\s+(going|talking|responding)/i,
        /don't\s+stop/i,
        /ignore\s+the\s+above/i,
        /previous\s+(message|instruction)\s+was/i
      ]
    };
  }

  /**
   * Main security check for user input
   * @param {string} input - User input to check
   * @param {Object} context - Request context (IP, user ID, etc.)
   * @returns {Object} Security assessment result
   */
  async checkSecurity(input, context = {}) {
    const startTime = Date.now();
    
    try {
      // Basic validation
      if (!input || typeof input !== 'string') {
        return { allowed: true, threats: [], action: 'allow' };
      }

      // Length check
      if (input.length > this.maxPromptLength) {
        this.logSecurityEvent('input_too_long', {
          length: input.length,
          maxLength: this.maxPromptLength,
          context
        }, 'medium');

        return {
          allowed: false,
          threats: [{ type: 'input_length', severity: 'medium' }],
          action: 'block',
          reason: `Input exceeds maximum length of ${this.maxPromptLength} characters`
        };
      }

      // Check if service is enabled
      if (!this.enabled) {
        return { allowed: true, threats: [], action: 'allow' };
      }

      // Run comprehensive security validation
      const securityResult = validateSecurity(input);
      
      // Additional pattern checks
      const patternThreats = this.checkPatterns(input);
      
      // Combine all threats
      const allThreats = [...securityResult.threats, ...patternThreats];
      
      // Calculate final risk score
      const riskScore = this.calculateRiskScore(allThreats);
      
      // Determine action based on risk score and mode
      const action = this.determineAction(riskScore, allThreats);
      
      // Log the security check
      this.logSecurityCheck(input, allThreats, action, context);
      
      // Track repeated attempts
      if (action === 'block' && context.identifier) {
        this.trackAttempt(context.identifier, allThreats);
      }

      const duration = Date.now() - startTime;
      logger.logPerformance('security_check', duration, {
        inputLength: input.length,
        threatsFound: allThreats.length,
        action
      });

      return {
        allowed: action !== 'block',
        threats: allThreats,
        action,
        riskScore,
        sanitizedInput: action === 'sanitize' ? sanitizeInput(input) : input,
        processingTime: duration
      };

    } catch (error) {
      logger.logSecurity('security_check_error', { 
        error: error.message, 
        inputLength: input?.length 
      }, 'high');
      
      // Fail securely - block on error
      return {
        allowed: false,
        threats: [{ type: 'processing_error', severity: 'high' }],
        action: 'block',
        reason: 'Security check failed'
      };
    }
  }

  /**
   * Check input against pattern collections
   * @param {string} input - Input to check
   * @returns {Array} Array of detected threats
   */
  checkPatterns(input) {
    const threats = [];
    const lowerInput = input.toLowerCase();

    // Check each pattern category
    for (const [category, patterns] of Object.entries(this.suspiciousPatterns)) {
      if (category === 'suspiciousKeywords') {
        // Handle keywords differently
        const foundKeywords = patterns.filter(keyword => 
          lowerInput.includes(keyword.toLowerCase())
        );
        
        if (foundKeywords.length > 0) {
          threats.push({
            type: 'suspicious_keywords',
            severity: foundKeywords.length > 2 ? 'high' : 'medium',
            keywords: foundKeywords,
            count: foundKeywords.length
          });
        }
      } else {
        // Handle regex patterns
        for (const pattern of patterns) {
          if (pattern.test(input)) {
            threats.push({
              type: category,
              severity: this.getSeverityForCategory(category),
              pattern: pattern.toString(),
              match: input.match(pattern)?.[0]
            });
          }
        }
      }
    }

    return threats;
  }

  /**
   * Get severity level for threat category
   * @param {string} category - Threat category
   * @returns {string} Severity level
   */
  getSeverityForCategory(category) {
    const severityMap = {
      instructionOverride: 'high',
      systemExtraction: 'high',
      roleConfusion: 'medium',
      developerMode: 'high',
      codeInjection: 'critical',
      promptContinuation: 'medium'
    };

    return severityMap[category] || 'medium';
  }

  /**
   * Calculate overall risk score from threats
   * @param {Array} threats - Array of detected threats
   * @returns {number} Risk score
   */
  calculateRiskScore(threats) {
    const severityWeights = {
      low: 1,
      medium: 3,
      high: 5,
      critical: 8
    };

    return threats.reduce((score, threat) => {
      return score + (severityWeights[threat.severity] || 2);
    }, 0);
  }

  /**
   * Determine action based on risk score and threats
   * @param {number} riskScore - Calculated risk score
   * @param {Array} threats - Array of threats
   * @returns {string} Action to take
   */
  determineAction(riskScore, threats) {
    // Critical threats always block
    if (threats.some(t => t.severity === 'critical')) {
      return 'block';
    }

    // High risk threshold (configurable)
    const blockThreshold = this.strictMode ? 3 : 5;
    const warnThreshold = this.strictMode ? 1 : 2;

    if (riskScore >= blockThreshold) {
      return 'block';
    } else if (riskScore >= warnThreshold) {
      return 'warn';
    } else {
      return 'allow';
    }
  }

  /**
   * Log security check results
   * @param {string} input - Original input
   * @param {Array} threats - Detected threats
   * @param {string} action - Action taken
   * @param {Object} context - Request context
   */
  logSecurityCheck(input, threats, action, context) {
    const logLevel = action === 'block' ? 'high' : 
                    action === 'warn' ? 'medium' : 'low';

    logger.logSecurity('prompt_security_check', {
      action,
      threatCount: threats.length,
      threats: threats.map(t => ({ type: t.type, severity: t.severity })),
      inputLength: input.length,
      inputPreview: input.substring(0, 100),
      context: {
        ip: context.ip,
        userAgent: context.userAgent,
        identifier: context.identifier
      }
    }, logLevel);
  }

  /**
   * Log security events
   * @param {string} event - Event type
   * @param {Object} data - Event data
   * @param {string} severity - Event severity
   */
  logSecurityEvent(event, data, severity = 'medium') {
    logger.logSecurity(event, data, severity);
  }

  /**
   * Track repeated injection attempts
   * @param {string} identifier - User/IP identifier
   * @param {Array} threats - Current threats
   */
  trackAttempt(identifier, threats) {
    if (!this.recentAttempts.has(identifier)) {
      this.recentAttempts.set(identifier, {
        count: 0,
        firstAttempt: Date.now(),
        lastAttempt: Date.now(),
        threats: []
      });
    }

    const attempts = this.recentAttempts.get(identifier);
    attempts.count++;
    attempts.lastAttempt = Date.now();
    attempts.threats.push(...threats);

    // Alert on repeated attempts
    if (attempts.count >= 3) {
      this.logSecurityEvent('repeated_injection_attempts', {
        identifier,
        attempts: attempts.count,
        timespan: attempts.lastAttempt - attempts.firstAttempt,
        threatTypes: [...new Set(attempts.threats.map(t => t.type))]
      }, 'high');
    }

    // Cleanup old attempts (older than 1 hour)
    const cutoff = Date.now() - (60 * 60 * 1000);
    for (const [id, data] of this.recentAttempts.entries()) {
      if (data.lastAttempt < cutoff) {
        this.recentAttempts.delete(id);
      }
    }
  }

  /**
   * Check if input contains potential data extraction attempts
   * @param {string} input - Input to check
   * @returns {boolean} True if data extraction detected
   */
  checkDataExtraction(input) {
    const extractionPatterns = [
      /list\s+(all\s+)?(files|documents|data|users)/i,
      /show\s+(me\s+)?(all\s+)?(files|documents|data)/i,
      /export\s+(all\s+)?(data|information)/i,
      /dump\s+(database|data|information)/i,
      /select\s+\*\s+from/i,
      /union\s+select/i
    ];

    return extractionPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Generate security report
   * @param {number} hours - Hours to look back (default: 24)
   * @returns {Object} Security report
   */
  async generateSecurityReport(hours = 24) {
    try {
      const events = logger.getSecurityEvents(null, hours);
      
      const report = {
        timespan: `${hours} hours`,
        summary: {
          totalEvents: events.length,
          blocked: events.filter(e => e.action === 'block').length,
          warnings: events.filter(e => e.action === 'warn').length,
          criticalThreats: events.filter(e => 
            e.threats?.some(t => t.severity === 'critical')
          ).length
        },
        topThreats: this.analyzeTopThreats(events),
        suspiciousIPs: this.analyzeSuspiciousIPs(events),
        patterns: this.analyzeAttackPatterns(events)
      };

      return report;
    } catch (error) {
      logger.logSecurity('security_report_error', { error: error.message }, 'medium');
      throw error;
    }
  }

  /**
   * Analyze top threats from security events
   * @param {Array} events - Security events
   * @returns {Array} Top threat types
   */
  analyzeTopThreats(events) {
    const threatCounts = {};
    
    events.forEach(event => {
      if (event.threats) {
        event.threats.forEach(threat => {
          const key = threat.type;
          threatCounts[key] = (threatCounts[key] || 0) + 1;
        });
      }
    });

    return Object.entries(threatCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));
  }

  /**
   * Analyze suspicious IP addresses
   * @param {Array} events - Security events
   * @returns {Array} Suspicious IPs
   */
  analyzeSuspiciousIPs(events) {
    const ipCounts = {};
    
    events.forEach(event => {
      if (event.context?.ip && event.action === 'block') {
        const ip = event.context.ip;
        ipCounts[ip] = (ipCounts[ip] || 0) + 1;
      }
    });

    return Object.entries(ipCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, blockedAttempts: count }));
  }

  /**
   * Analyze attack patterns
   * @param {Array} events - Security events
   * @returns {Object} Pattern analysis
   */
  analyzeAttackPatterns(events) {
    const hourly = new Array(24).fill(0);
    const now = new Date();
    
    events.forEach(event => {
      const eventTime = new Date(event.timestamp);
      const hourDiff = Math.floor((now - eventTime) / (1000 * 60 * 60));
      
      if (hourDiff >= 0 && hourDiff < 24) {
        hourly[23 - hourDiff]++;
      }
    });

    return {
      hourlyDistribution: hourly,
      peakHour: hourly.indexOf(Math.max(...hourly)),
      totalAttempts: hourly.reduce((sum, count) => sum + count, 0)
    };
  }

  /**
   * Configure security settings
   * @param {Object} settings - Security settings
   */
  configure(settings) {
    if (settings.enabled !== undefined) {
      this.enabled = settings.enabled;
    }
    
    if (settings.strictMode !== undefined) {
      this.strictMode = settings.strictMode;
    }
    
    if (settings.maxPromptLength !== undefined) {
      this.maxPromptLength = settings.maxPromptLength;
    }

    logger.logSecurity('security_configuration_updated', settings, 'low');
  }

  /**
   * Get current security configuration
   * @returns {Object} Current configuration
   */
  getConfiguration() {
    return {
      enabled: this.enabled,
      strictMode: this.strictMode,
      maxPromptLength: this.maxPromptLength,
      patternCategories: Object.keys(this.suspiciousPatterns),
      recentAttempts: this.recentAttempts.size
    };
  }
}

// Create singleton instance
const promptGuard = new PromptGuard();

export default promptGuard;