/**
 * Structured logging utility for RAG and security operations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

class Logger {
  constructor() {
    // FIX: Resolve data directory relative to backend root, not process.cwd()
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const backendDir = path.resolve(__dirname, '..');

    this.logDir = path.join(backendDir, 'data');

    console.log('[Logger] Log directory:', this.logDir);
    this.ensureLogDirectory();
  }

  /**
   * Ensure log directory exists
   */
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Get timestamp in ISO format
   * @returns {string} ISO timestamp
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Write log entry to file
   * @param {string} filename - Log filename
   * @param {Object} entry - Log entry object
   */
  writeLog(filename, entry) {
    try {
      const logPath = path.join(this.logDir, filename);
      const logEntry = {
        timestamp: this.getTimestamp(),
        ...entry
      };

      // Append to existing logs or create new file
      let logs = [];
      if (fs.existsSync(logPath)) {
        const existingData = fs.readFileSync(logPath, 'utf8');
        if (existingData.trim()) {
          logs = JSON.parse(existingData);
        }
      }

      logs.push(logEntry);

      // Keep only last 1000 entries to prevent file bloat
      if (logs.length > 1000) {
        logs = logs.slice(-1000);
      }

      fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
    } catch (error) {
      console.error('Failed to write log:', error);
    }
  }

  /**
   * Log RAG operations
   * @param {string} operation - Operation type
   * @param {Object} data - Operation data
   * @param {string} level - Log level (info, warn, error)
   */
  logRAG(operation, data = {}, level = 'info') {
    const entry = {
      type: 'rag',
      level,
      operation,
      ...data
    };

    this.writeLog('rag.log.json', entry);
    
    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[RAG ${level.toUpperCase()}] ${operation}:`, data);
    }
  }

  /**
   * Log security events
   * @param {string} event - Security event type
   * @param {Object} data - Event data
   * @param {string} severity - Severity level (low, medium, high, critical)
   */
  logSecurity(event, data = {}, severity = 'medium') {
    const entry = {
      type: 'security',
      severity,
      event,
      ...data
    };

    this.writeLog('security.log.json', entry);
    
    // Always log security events to console
    console.warn(`[SECURITY ${severity.toUpperCase()}] ${event}:`, data);
  }

  /**
   * Log performance metrics
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in milliseconds
   * @param {Object} metadata - Additional metadata
   */
  logPerformance(operation, duration, metadata = {}) {
    const entry = {
      type: 'performance',
      operation,
      duration,
      ...metadata
    };

    this.writeLog('performance.log.json', entry);
  }

  /**
   * Log document processing events
   * @param {string} filename - Document filename
   * @param {string} operation - Processing operation
   * @param {Object} stats - Processing statistics
   */
  logDocument(filename, operation, stats = {}) {
    const entry = {
      type: 'document',
      filename,
      operation,
      stats
    };

    this.writeLog('documents.log.json', entry);
  }

  /**
   * Log embedding operations
   * @param {string} model - Embedding model used
   * @param {number} chunks - Number of chunks processed
   * @param {Object} metadata - Additional metadata
   */
  logEmbedding(model, chunks, metadata = {}) {
    const entry = {
      type: 'embedding',
      model,
      chunks,
      ...metadata
    };

    this.writeLog('embeddings.log.json', entry);
  }

  /**
   * Read logs from file
   * @param {string} filename - Log filename
   * @param {number} limit - Number of recent entries to return
   * @returns {Array} Array of log entries
   */
  readLogs(filename, limit = 100) {
    try {
      const logPath = path.join(this.logDir, filename);
      if (!fs.existsSync(logPath)) {
        return [];
      }

      const logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      return logs.slice(-limit);
    } catch (error) {
      console.error('Failed to read logs:', error);
      return [];
    }
  }

  /**
   * Get security events by severity
   * @param {string} severity - Severity level to filter by
   * @param {number} hours - Hours to look back (default: 24)
   * @returns {Array} Filtered security events
   */
  getSecurityEvents(severity = null, hours = 24) {
    const logs = this.readLogs('security.log.json', 1000);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    return logs.filter(log => {
      const logTime = new Date(log.timestamp);
      const matchesSeverity = !severity || log.severity === severity;
      const isRecent = logTime > cutoff;
      
      return matchesSeverity && isRecent;
    });
  }

  /**
   * Get performance statistics
   * @param {string} operation - Operation to analyze
   * @param {number} hours - Hours to look back
   * @returns {Object} Performance statistics
   */
  getPerformanceStats(operation = null, hours = 24) {
    const logs = this.readLogs('performance.log.json', 1000);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const filteredLogs = logs.filter(log => {
      const logTime = new Date(log.timestamp);
      const matchesOp = !operation || log.operation === operation;
      const isRecent = logTime > cutoff;
      
      return matchesOp && isRecent;
    });

    if (filteredLogs.length === 0) {
      return { count: 0, avgDuration: 0, minDuration: 0, maxDuration: 0 };
    }

    const durations = filteredLogs.map(log => log.duration);
    
    return {
      count: filteredLogs.length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      operations: filteredLogs.map(log => ({
        timestamp: log.timestamp,
        duration: log.duration,
        operation: log.operation
      }))
    };
  }

  /**
   * Clear old logs beyond retention period
   * @param {number} days - Days to retain (default: 30)
   */
  cleanupLogs(days = 30) {
    const logFiles = ['rag.log.json', 'security.log.json', 'performance.log.json', 'documents.log.json', 'embeddings.log.json'];
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    logFiles.forEach(filename => {
      try {
        const logs = this.readLogs(filename, 10000);
        const filteredLogs = logs.filter(log => new Date(log.timestamp) > cutoff);
        
        const logPath = path.join(this.logDir, filename);
        fs.writeFileSync(logPath, JSON.stringify(filteredLogs, null, 2));
        
        this.logRAG('log_cleanup', { 
          filename, 
          removed: logs.length - filteredLogs.length,
          retained: filteredLogs.length 
        });
      } catch (error) {
        console.error(`Failed to cleanup ${filename}:`, error);
      }
    });
  }
}

// Create singleton instance
const logger = new Logger();

export default logger;

// Export specific logging functions for convenience
export const logRAG = logger.logRAG.bind(logger);
export const logSecurity = logger.logSecurity.bind(logger);
export const logPerformance = logger.logPerformance.bind(logger);
export const logDocument = logger.logDocument.bind(logger);
export const logEmbedding = logger.logEmbedding.bind(logger);