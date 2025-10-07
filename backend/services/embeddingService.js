/**
 * Embedding service using Ollama's embedding models
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';

class EmbeddingService {
  constructor() {
    // Use the same Ollama path as the main server
    this.OLLAMA_PATH = path.resolve(process.cwd(), "..", "resources", "ollama.exe");
    this.defaultModel = 'nomic-embed-text';
    this.embeddingCache = new Map(); // Simple cache to avoid re-embedding identical text
    
    console.log("Embedding Service OLLAMA_PATH:", this.OLLAMA_PATH, "exists?", fs.existsSync(this.OLLAMA_PATH));
  }

  /**
   * Generate embeddings for text using Ollama
   * @param {string} text - Text to embed
   * @param {string} model - Embedding model to use
   * @returns {Promise<number[]>} Embedding vector
   */
  async generateEmbedding(text, model = this.defaultModel) {
    const startTime = Date.now();
    
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    // Check cache first
    const cacheKey = `${model}:${this.hashText(text)}`;
    if (this.embeddingCache.has(cacheKey)) {
      logger.logEmbedding(model, 1, { cached: true, textLength: text.length });
      return this.embeddingCache.get(cacheKey);
    }

    try {
      // Clean and limit text length
      const cleanText = text.trim().substring(0, 8000); // Limit to prevent token overflow
      
      const embedding = await this.callOllamaEmbedding(cleanText, model);
      
      // Cache the result
      this.embeddingCache.set(cacheKey, embedding);
      
      // Limit cache size
      if (this.embeddingCache.size > 1000) {
        const firstKey = this.embeddingCache.keys().next().value;
        this.embeddingCache.delete(firstKey);
      }

      const duration = Date.now() - startTime;
      logger.logEmbedding(model, 1, { 
        textLength: cleanText.length, 
        embeddingDimension: embedding.length,
        duration 
      });
      logger.logPerformance('generate_embedding', duration, { 
        model, 
        textLength: cleanText.length 
      });

      return embedding;
    } catch (error) {
      logger.logRAG('embedding_generation_error', { 
        error: error.message, 
        model, 
        textLength: text.length 
      }, 'error');
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * @param {string[]} texts - Array of texts to embed
   * @param {string} model - Embedding model to use
   * @param {function} progressCallback - Optional progress callback
   * @returns {Promise<number[][]>} Array of embedding vectors
   */
  async generateEmbeddings(texts, model = this.defaultModel, progressCallback = null) {
    const startTime = Date.now();
    
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error('Texts must be a non-empty array');
    }

    const embeddings = [];
    const batchSize = 5; // Process in small batches to avoid overwhelming Ollama
    
    logger.logEmbedding(model, texts.length, { batchMode: true, batchSize });

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await Promise.all(
        batch.map(text => this.generateEmbedding(text, model))
      );
      
      embeddings.push(...batchEmbeddings);
      
      if (progressCallback) {
        progressCallback(Math.min(i + batchSize, texts.length), texts.length);
      }

      // Small delay between batches to be respectful to Ollama
      if (i + batchSize < texts.length) {
        await this.delay(500);
      }
    }

    const duration = Date.now() - startTime;
    logger.logPerformance('generate_embeddings_batch', duration, { 
      count: texts.length, 
      model,
      avgPerEmbedding: duration / texts.length 
    });

    return embeddings;
  }

  /**
   * Call Ollama embedding API via REST endpoint
   * @param {string} text - Text to embed
   * @param {string} model - Model to use
   * @returns {Promise<number[]>} Embedding vector
   */
  async callOllamaEmbedding(text, model) {
    try {
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          prompt: text
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API responded with status ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error('Invalid embedding response from Ollama API');
      }

      return data.embedding;
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to Ollama server. Make sure Ollama is running on http://localhost:11434');
      }
      throw new Error(`Ollama embedding API error: ${error.message}`);
    }
  }


  /**
   * Check if embedding model is available
   * @param {string} model - Model name to check
   * @returns {Promise<boolean>} True if model is available
   */
  async isModelAvailable(model) {
    try {
      // Check if Ollama server is running and model is available
      const response = await fetch('http://localhost:11434/api/tags');
      if (!response.ok) {
        return false;
      }
      
      const data = await response.json();
      const availableModels = data.models || [];
      const isAvailable = availableModels.some(m => m.name.includes(model));
      
      if (isAvailable) {
        // Double-check by trying a small test embedding
        await this.generateEmbedding('test', model);
      }
      
      return isAvailable;
    } catch (error) {
      logger.logRAG('model_availability_check', { model, available: false, error: error.message });
      return false;
    }
  }

  /**
   * Get available embedding models
   * @returns {Promise<string[]>} Array of available model names
   */
  async getAvailableModels() {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const models = data.models || [];
      
      // Filter for embedding models
      const embeddingModels = models
        .map(model => model.name)
        .filter(name => 
          name.includes('embed') || 
          name.includes('sentence') ||
          name.includes('nomic')
        );
      
      return embeddingModels;
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to Ollama server. Make sure Ollama is running on http://localhost:11434');
      }
      throw new Error(`Model list error: ${error.message}`);
    }
  }


  /**
   * Create a hash of text for caching
   * @param {string} text - Text to hash
   * @returns {string} Hash string
   */
  hashText(text) {
    // Simple hash function for caching
    let hash = 0;
    if (text.length === 0) return hash.toString();
    
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return hash.toString();
  }

  /**
   * Clear embedding cache
   */
  clearCache() {
    this.embeddingCache.clear();
    logger.logRAG('embedding_cache_cleared');
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      size: this.embeddingCache.size,
      maxSize: 1000
    };
  }

  /**
   * Simple delay utility
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create singleton instance
const embeddingService = new EmbeddingService();

export default embeddingService;