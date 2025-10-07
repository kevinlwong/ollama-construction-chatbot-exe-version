/**
 * RAG (Retrieval-Augmented Generation) service
 * Orchestrates document processing, embedding, storage, and retrieval
 */

import { chunkText, smartChunk } from '../utils/chunking.js';
import embeddingService from './embeddingService.js';
import vectorStore from './vectorStore.js';
import logger from '../utils/logger.js';

class RAGService {
  constructor() {
    this.defaultChunkSize = 500;
    this.defaultOverlap = 50;
    this.defaultSimilarityThreshold = 0.1;
    this.maxContextLength = 8000; // Maximum context length for prompt assembly
  }

  /**
   * Process a document and add it to the RAG system
   * @param {string} text - Document text content
   * @param {string} projectId - Project ID to associate document with
   * @param {Object} metadata - Document metadata
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing result
   */
  async processDocument(text, projectId, metadata = {}, options = {}) {
    const startTime = Date.now();
    
    try {
      logger.logRAG('document_processing_start', { 
        projectId, 
        textLength: text.length, 
        filename: metadata.filename 
      });

      // Validate project exists
      const project = await vectorStore.getProject(projectId);
      if (!project) {
        throw new Error(`Project '${projectId}' not found`);
      }

      // Configure chunking options
      const chunkOptions = {
        chunkSize: options.chunkSize || this.defaultChunkSize,
        overlap: options.overlap || this.defaultOverlap,
        separator: options.separator || 'sentence'
      };

      // Step 1: Chunk the document
      logger.logRAG('chunking_start', { projectId, chunkOptions });
      const chunks = options.smartChunking ? 
        smartChunk(text, chunkOptions) : 
        chunkText(text, chunkOptions);

      if (chunks.length === 0) {
        throw new Error('No chunks generated from document');
      }

      logger.logRAG('chunking_complete', { 
        projectId, 
        chunkCount: chunks.length,
        avgChunkSize: chunks.reduce((sum, c) => sum + c.charCount, 0) / chunks.length
      });

      // Step 2: Generate embeddings for all chunks
      logger.logRAG('embedding_start', { projectId, chunkCount: chunks.length });
      
      const texts = chunks.map(chunk => chunk.text);
      const progressCallback = (completed, total) => {
        logger.logRAG('embedding_progress', { 
          projectId, 
          completed, 
          total, 
          percentage: Math.round((completed / total) * 100) 
        });
      };

      const embeddings = await embeddingService.generateEmbeddings(
        texts, 
        options.embeddingModel, 
        progressCallback
      );

      // Step 3: Combine chunks with their embeddings
      const chunksWithEmbeddings = chunks.map((chunk, index) => ({
        ...chunk,
        embedding: embeddings[index]
      }));

      // Step 4: Store in vector database
      logger.logRAG('storage_start', { projectId, chunkCount: chunksWithEmbeddings.length });
      
      const chunkIds = await vectorStore.addChunks(
        chunksWithEmbeddings, 
        projectId, 
        {
          source_file: metadata.filename || 'unknown',
          file_type: metadata.file_type,
          upload_date: new Date().toISOString(),
          file_size: metadata.file_size,
          page_count: metadata.page_count,
          processing_options: chunkOptions
        }
      );

      const duration = Date.now() - startTime;
      
      logger.logDocument(
        metadata.filename || 'unknown',
        'processed_and_stored',
        {
          projectId,
          chunkCount: chunks.length,
          textLength: text.length,
          duration,
          embeddingModel: options.embeddingModel || embeddingService.defaultModel
        }
      );

      logger.logPerformance('process_document', duration, {
        projectId,
        chunkCount: chunks.length,
        textLength: text.length
      });

      return {
        success: true,
        projectId,
        chunkIds,
        stats: {
          chunkCount: chunks.length,
          totalCharacters: text.length,
          averageChunkSize: chunks.reduce((sum, c) => sum + c.charCount, 0) / chunks.length,
          processingTime: duration
        }
      };

    } catch (error) {
      logger.logRAG('document_processing_error', { 
        error: error.message, 
        projectId, 
        filename: metadata.filename 
      }, 'error');
      throw new Error(`Document processing failed: ${error.message}`);
    }
  }

  /**
   * Retrieve relevant context for a query
   * @param {string} query - User query
   * @param {Object} options - Retrieval options
   * @returns {Promise<Object>} Retrieval result with context
   */
  async retrieveContext(query, options = {}) {
    const startTime = Date.now();
    
    try {
      const {
        projectId = null,
        limit = 5,
        threshold = this.defaultSimilarityThreshold,
        includeMetadata = false,
        maxContextLength = this.maxContextLength
      } = options;

      logger.logRAG('context_retrieval_start', { 
        query: query.substring(0, 100), 
        projectId, 
        limit, 
        threshold 
      });

      // Step 1: Generate embedding for the query
      const queryEmbedding = await embeddingService.generateEmbedding(query);

      // Step 2: Search for similar chunks
      const similarChunks = await vectorStore.searchSimilar(queryEmbedding, {
        projectId,
        limit: limit * 2, // Get more chunks than needed for better selection
        threshold,
        includeMetadata
      });

      if (similarChunks.length === 0) {
        logger.logRAG('no_context_found', { query: query.substring(0, 100), projectId });
        return {
          context: '',
          chunks: [],
          stats: {
            chunksFound: 0,
            contextLength: 0,
            retrievalTime: Date.now() - startTime
          }
        };
      }

      // Step 3: Assemble context with length limitation
      const { context, selectedChunks } = this.assembleContext(
        similarChunks, 
        maxContextLength
      );

      const duration = Date.now() - startTime;

      logger.logRAG('context_retrieval_complete', {
        query: query.substring(0, 100),
        projectId,
        chunksFound: similarChunks.length,
        chunksSelected: selectedChunks.length,
        contextLength: context.length,
        avgSimilarity: selectedChunks.reduce((sum, c) => sum + c.similarity, 0) / selectedChunks.length
      });

      logger.logPerformance('retrieve_context', duration, {
        projectId,
        queryLength: query.length,
        chunksRetrieved: selectedChunks.length
      });

      return {
        context,
        chunks: selectedChunks,
        stats: {
          chunksFound: similarChunks.length,
          chunksSelected: selectedChunks.length,
          contextLength: context.length,
          retrievalTime: duration,
          averageSimilarity: selectedChunks.reduce((sum, c) => sum + c.similarity, 0) / selectedChunks.length
        }
      };

    } catch (error) {
      logger.logRAG('context_retrieval_error', { 
        error: error.message, 
        query: query.substring(0, 100), 
        projectId 
      }, 'error');
      throw new Error(`Context retrieval failed: ${error.message}`);
    }
  }

  /**
   * Assemble context from chunks with length constraints
   * @param {Array} chunks - Array of similar chunks
   * @param {number} maxLength - Maximum context length
   * @returns {Object} Assembled context and selected chunks
   */
  assembleContext(chunks, maxLength) {
    const selectedChunks = [];
    let currentLength = 0;
    
    // Sort chunks by similarity (already sorted, but ensure it)
    const sortedChunks = chunks.sort((a, b) => b.similarity - a.similarity);

    // Add separator between chunks
    const separator = '\n\n---\n\n';
    const separatorLength = separator.length;

    for (const chunk of sortedChunks) {
      const chunkLength = chunk.text.length;
      const nextLength = currentLength + chunkLength + 
        (selectedChunks.length > 0 ? separatorLength : 0);

      if (nextLength > maxLength && selectedChunks.length > 0) {
        break;
      }

      selectedChunks.push(chunk);
      currentLength = nextLength;

      // Always include at least one chunk, even if it exceeds limit
      if (selectedChunks.length === 1 && currentLength > maxLength) {
        // Truncate the first chunk if it's too long
        const truncatedText = chunk.text.substring(0, maxLength - 100) + '...';
        selectedChunks[0] = { ...chunk, text: truncatedText };
        currentLength = truncatedText.length;
        break;
      }
    }

    // Assemble final context
    const context = selectedChunks.map(chunk => chunk.text).join(separator);

    return { context, selectedChunks };
  }

  /**
   * Enhanced query processing with project detection
   * @param {string} query - User query
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Enhanced retrieval result
   */
  async enhancedRetrieve(query, options = {}) {
    const startTime = Date.now();
    
    try {
      // Step 1: Detect project mentions in query
      const detectedProject = await this.detectProjectInQuery(query);
      const projectId = options.projectId || detectedProject;

      logger.logRAG('enhanced_retrieve_start', { 
        query: query.substring(0, 100),
        detectedProject,
        finalProjectId: projectId
      });

      // Step 2: Retrieve basic context
      const basicResult = await this.retrieveContext(query, { 
        ...options, 
        projectId 
      });

      // Step 3: If no good results and no project specified, try global search
      if (basicResult.chunks.length === 0 && !projectId) {
        logger.logRAG('fallback_to_global_search', { query: query.substring(0, 100) });
        
        const globalResult = await this.retrieveContext(query, {
          ...options,
          projectId: null, // Global search
          threshold: Math.max(0.05, options.threshold - 0.05) // Lower threshold
        });

        if (globalResult.chunks.length > 0) {
          return {
            ...globalResult,
            searchType: 'global_fallback',
            detectedProject
          };
        }
      }

      return {
        ...basicResult,
        searchType: projectId ? 'project_specific' : 'global',
        detectedProject,
        projectId
      };

    } catch (error) {
      logger.logRAG('enhanced_retrieve_error', { 
        error: error.message, 
        query: query.substring(0, 100) 
      }, 'error');
      throw error;
    }
  }

  /**
   * Detect project mentions in user query
   * @param {string} query - User query
   * @returns {Promise<string|null>} Detected project ID or null
   */
  async detectProjectInQuery(query) {
    try {
      const projects = await vectorStore.getProjects();
      const lowerQuery = query.toLowerCase();

      // Look for exact project name matches
      for (const project of projects) {
        const projectNameLower = project.name.toLowerCase();
        const projectIdLower = project.id.toLowerCase();

        if (lowerQuery.includes(projectNameLower) || 
            lowerQuery.includes(projectIdLower)) {
          return project.id;
        }

        // Check project tags
        if (project.tags) {
          for (const tag of project.tags) {
            if (lowerQuery.includes(tag.toLowerCase())) {
              return project.id;
            }
          }
        }
      }

      return null;
    } catch (error) {
      logger.logRAG('project_detection_error', { error: error.message }, 'error');
      return null;
    }
  }

  /**
   * Get RAG system statistics
   * @returns {Promise<Object>} System statistics
   */
  async getSystemStats() {
    try {
      const vectorStats = await vectorStore.getStats();
      const embeddingStats = embeddingService.getCacheStats();

      return {
        vector_store: vectorStats,
        embedding_cache: embeddingStats,
        system_info: {
          default_chunk_size: this.defaultChunkSize,
          default_overlap: this.defaultOverlap,
          default_threshold: this.defaultSimilarityThreshold,
          max_context_length: this.maxContextLength
        }
      };
    } catch (error) {
      logger.logRAG('get_system_stats_error', { error: error.message }, 'error');
      throw error;
    }
  }

  /**
   * Search documents by text similarity (no embedding required)
   * @param {string} searchTerm - Text to search for
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Matching chunks
   */
  async textSearch(searchTerm, options = {}) {
    try {
      const { projectId = null, limit = 10 } = options;
      
      // Get all chunks for the project or globally
      const allChunks = projectId ? 
        await vectorStore.getChunksByProject(projectId, 1000) :
        (await vectorStore.loadVectorStore()).chunks;

      const searchTermLower = searchTerm.toLowerCase();
      
      // Simple text-based search
      const matches = allChunks
        .filter(chunk => chunk.text.toLowerCase().includes(searchTermLower))
        .map(chunk => ({
          ...chunk,
          relevance: this.calculateTextRelevance(chunk.text, searchTerm)
        }))
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, limit);

      return matches;
    } catch (error) {
      logger.logRAG('text_search_error', { error: error.message, searchTerm }, 'error');
      throw error;
    }
  }

  /**
   * Calculate text relevance score for search
   * @param {string} text - Text to score
   * @param {string} searchTerm - Search term
   * @returns {number} Relevance score
   */
  calculateTextRelevance(text, searchTerm) {
    const textLower = text.toLowerCase();
    const termLower = searchTerm.toLowerCase();
    
    // Count occurrences
    const occurrences = (textLower.match(new RegExp(termLower, 'g')) || []).length;
    
    // Boost score if term appears at the beginning
    const startsWithBoost = textLower.startsWith(termLower) ? 2 : 1;
    
    // Normalize by text length
    const normalizedScore = (occurrences * startsWithBoost) / Math.sqrt(text.length);
    
    return normalizedScore;
  }

  /**
   * Clean up system resources
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanup() {
    try {
      const orphanedChunks = await vectorStore.cleanupOrphanedChunks();
      embeddingService.clearCache();
      
      logger.logRAG('system_cleanup', { orphanedChunks });
      
      return {
        orphaned_chunks_removed: orphanedChunks,
        embedding_cache_cleared: true
      };
    } catch (error) {
      logger.logRAG('cleanup_error', { error: error.message }, 'error');
      throw error;
    }
  }
}

// Create singleton instance
const ragService = new RAGService();

export default ragService;