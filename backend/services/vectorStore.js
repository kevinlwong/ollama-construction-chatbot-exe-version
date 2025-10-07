/**
 * JSON-based vector storage service for RAG implementation
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { cosineSimilarity } from '../utils/math.js';
import logger from '../utils/logger.js';

class VectorStore {
  constructor() {
    // FIX: Resolve data directory relative to this file's location, not process.cwd()
    // This ensures correct paths in both dev mode and packaged Electron app
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const backendDir = path.resolve(__dirname, '..');

    this.vectorStorePath = path.join(backendDir, 'data', 'vector_store.json');
    this.projectsPath = path.join(backendDir, 'data', 'projects.json');

    console.log('[VectorStore] Data paths initialized:');
    console.log('  Vector store:', this.vectorStorePath);
    console.log('  Projects:', this.projectsPath);
    console.log('  Vector store exists:', fs.existsSync(this.vectorStorePath));
    console.log('  Projects exists:', fs.existsSync(this.projectsPath));

    this.ensureDataFiles();
  }

  /**
   * Ensure data files exist with proper structure
   */
  ensureDataFiles() {
    const dataDir = path.dirname(this.vectorStorePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Initialize vector store if it doesn't exist
    if (!fs.existsSync(this.vectorStorePath)) {
      const initialStore = {
        version: "1.0",
        created: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        embeddings_model: "nomic-embed-text",
        chunk_size: 500,
        overlap: 50,
        projects: [],
        chunks: [],
        stats: {
          total_documents: 0,
          total_chunks: 0,
          total_projects: 0,
          last_embedding_update: null
        }
      };
      fs.writeFileSync(this.vectorStorePath, JSON.stringify(initialStore, null, 2));
    }

    // Initialize projects if it doesn't exist
    if (!fs.existsSync(this.projectsPath)) {
      const initialProjects = {
        version: "1.0",
        created: new Date().toISOString(),
        projects: []
      };
      fs.writeFileSync(this.projectsPath, JSON.stringify(initialProjects, null, 2));
    }
  }

  /**
   * Load vector store from JSON file
   * @returns {Object} Vector store data
   */
  async loadVectorStore() {
    try {
      const data = await fsp.readFile(this.vectorStorePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.logRAG('load_vector_store_error', { error: error.message }, 'error');
      throw new Error(`Failed to load vector store: ${error.message}`);
    }
  }

  /**
   * Save vector store to JSON file
   * @param {Object} data - Vector store data
   */
  async saveVectorStore(data) {
    try {
      data.last_updated = new Date().toISOString();
      await fsp.writeFile(this.vectorStorePath, JSON.stringify(data, null, 2));
      logger.logRAG('save_vector_store', { chunks: data.chunks.length, projects: data.projects.length });
    } catch (error) {
      logger.logRAG('save_vector_store_error', { error: error.message }, 'error');
      throw new Error(`Failed to save vector store: ${error.message}`);
    }
  }

  /**
   * Load projects from JSON file
   * @returns {Object} Projects data
   */
  async loadProjects() {
    try {
      const data = await fsp.readFile(this.projectsPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.logRAG('load_projects_error', { error: error.message }, 'error');
      throw new Error(`Failed to load projects: ${error.message}`);
    }
  }

  /**
   * Save projects to JSON file
   * @param {Object} data - Projects data
   */
  async saveProjects(data) {
    try {
      await fsp.writeFile(this.projectsPath, JSON.stringify(data, null, 2));
      logger.logRAG('save_projects', { projectCount: data.projects.length });
    } catch (error) {
      logger.logRAG('save_projects_error', { error: error.message }, 'error');
      throw new Error(`Failed to save projects: ${error.message}`);
    }
  }

  /**
   * Add a new project
   * @param {Object} project - Project object
   * @returns {Object} Created project
   */
  async addProject(project) {
    const startTime = Date.now();
    
    try {
      const projectsData = await this.loadProjects();
      
      // Check if project ID already exists
      if (projectsData.projects.find(p => p.id === project.id)) {
        throw new Error(`Project with ID '${project.id}' already exists`);
      }

      const newProject = {
        id: project.id,
        name: project.name,
        description: project.description || '',
        active: project.active !== undefined ? project.active : true,
        created: new Date().toISOString(),
        tags: project.tags || [],
        metadata: project.metadata || {},
        document_count: 0
      };

      projectsData.projects.push(newProject);
      await this.saveProjects(projectsData);

      logger.logRAG('project_created', { projectId: project.id, name: project.name });
      logger.logPerformance('add_project', Date.now() - startTime);

      return newProject;
    } catch (error) {
      logger.logRAG('add_project_error', { error: error.message, projectId: project.id }, 'error');
      throw error;
    }
  }

  /**
   * Get all projects
   * @returns {Array} Array of projects
   */
  async getProjects() {
    try {
      const projectsData = await this.loadProjects();
      return projectsData.projects;
    } catch (error) {
      logger.logRAG('get_projects_error', { error: error.message }, 'error');
      throw error;
    }
  }

  /**
   * Get project by ID
   * @param {string} projectId - Project ID
   * @returns {Object|null} Project object or null if not found
   */
  async getProject(projectId) {
    try {
      const projectsData = await this.loadProjects();
      return projectsData.projects.find(p => p.id === projectId) || null;
    } catch (error) {
      logger.logRAG('get_project_error', { error: error.message, projectId }, 'error');
      throw error;
    }
  }

  /**
   * Add chunks to vector store
   * @param {Array} chunks - Array of chunk objects with embeddings
   * @param {string} projectId - Project ID
   * @param {Object} metadata - Additional metadata
   * @returns {Array} Array of added chunk IDs
   */
  async addChunks(chunks, projectId, metadata = {}) {
    const startTime = Date.now();
    
    try {
      const vectorStore = await this.loadVectorStore();
      const addedIds = [];

      for (const chunk of chunks) {
        const chunkId = uuidv4();
        const chunkObject = {
          id: chunkId,
          project_id: projectId,
          text: chunk.text,
          embedding: chunk.embedding,
          metadata: {
            source_file: metadata.source_file || 'unknown',
            chunk_index: chunk.index || 0,
            token_count: chunk.tokenCount || 0,
            word_count: chunk.wordCount || 0,
            char_count: chunk.charCount || 0,
            chunk_type: chunk.type || 'general',
            created: new Date().toISOString(),
            page_number: metadata.page_number,
            ...metadata
          }
        };

        vectorStore.chunks.push(chunkObject);
        addedIds.push(chunkId);
      }

      // Update stats
      vectorStore.stats.total_chunks = vectorStore.chunks.length;
      vectorStore.stats.last_embedding_update = new Date().toISOString();

      await this.saveVectorStore(vectorStore);

      // Update project document count
      await this.updateProjectDocumentCount(projectId);

      logger.logRAG('chunks_added', { 
        projectId, 
        chunkCount: chunks.length, 
        sourceFile: metadata.source_file 
      });
      logger.logPerformance('add_chunks', Date.now() - startTime, { chunkCount: chunks.length });

      return addedIds;
    } catch (error) {
      logger.logRAG('add_chunks_error', { error: error.message, projectId }, 'error');
      throw error;
    }
  }

  /**
   * Search for similar chunks using cosine similarity
   * @param {number[]} queryEmbedding - Query embedding vector
   * @param {Object} options - Search options
   * @returns {Array} Array of matching chunks with similarity scores
   */
  async searchSimilar(queryEmbedding, options = {}) {
    const startTime = Date.now();
    
    try {
      const {
        projectId = null,
        limit = 5,
        threshold = 0.1,
        includeMetadata = false
      } = options;

      const vectorStore = await this.loadVectorStore();
      let chunks = vectorStore.chunks;

      // Filter by project if specified
      if (projectId) {
        chunks = chunks.filter(chunk => chunk.project_id === projectId);
      }

      // Calculate similarities
      const similarities = chunks.map(chunk => {
        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        return {
          ...chunk,
          similarity
        };
      });

      // Filter by threshold and sort by similarity
      const filtered = similarities
        .filter(chunk => chunk.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      // Optionally remove metadata for lighter response
      const results = filtered.map(chunk => {
        const result = {
          id: chunk.id,
          project_id: chunk.project_id,
          text: chunk.text,
          similarity: chunk.similarity
        };

        if (includeMetadata) {
          result.metadata = chunk.metadata;
        }

        return result;
      });

      logger.logRAG('similarity_search', { 
        queryProjectId: projectId,
        resultsFound: results.length,
        threshold,
        limit
      });
      logger.logPerformance('search_similar', Date.now() - startTime, { 
        searchedChunks: chunks.length,
        resultsFound: results.length 
      });

      return results;
    } catch (error) {
      logger.logRAG('search_similar_error', { error: error.message }, 'error');
      throw error;
    }
  }

  /**
   * Get chunks by project ID
   * @param {string} projectId - Project ID
   * @param {number} limit - Maximum number of chunks to return
   * @returns {Array} Array of chunks
   */
  async getChunksByProject(projectId, limit = 100) {
    try {
      const vectorStore = await this.loadVectorStore();
      const projectChunks = vectorStore.chunks
        .filter(chunk => chunk.project_id === projectId)
        .slice(0, limit);

      return projectChunks;
    } catch (error) {
      logger.logRAG('get_chunks_by_project_error', { error: error.message, projectId }, 'error');
      throw error;
    }
  }

  /**
   * Delete chunks by project ID
   * @param {string} projectId - Project ID
   * @returns {number} Number of deleted chunks
   */
  async deleteChunksByProject(projectId) {
    try {
      const vectorStore = await this.loadVectorStore();
      const initialCount = vectorStore.chunks.length;
      
      vectorStore.chunks = vectorStore.chunks.filter(chunk => chunk.project_id !== projectId);
      
      const deletedCount = initialCount - vectorStore.chunks.length;
      vectorStore.stats.total_chunks = vectorStore.chunks.length;

      await this.saveVectorStore(vectorStore);

      logger.logRAG('chunks_deleted', { projectId, deletedCount });
      
      return deletedCount;
    } catch (error) {
      logger.logRAG('delete_chunks_error', { error: error.message, projectId }, 'error');
      throw error;
    }
  }

  /**
   * Update project document count
   * @param {string} projectId - Project ID
   */
  async updateProjectDocumentCount(projectId) {
    try {
      const vectorStore = await this.loadVectorStore();
      const projectsData = await this.loadProjects();
      
      const documentCount = new Set(
        vectorStore.chunks
          .filter(chunk => chunk.project_id === projectId)
          .map(chunk => chunk.metadata.source_file)
      ).size;

      const project = projectsData.projects.find(p => p.id === projectId);
      if (project) {
        project.document_count = documentCount;
        await this.saveProjects(projectsData);
      }
    } catch (error) {
      logger.logRAG('update_document_count_error', { error: error.message, projectId }, 'error');
    }
  }

  /**
   * Get vector store statistics
   * @returns {Object} Statistics object
   */
  async getStats() {
    try {
      const vectorStore = await this.loadVectorStore();
      const projectsData = await this.loadProjects();

      const projectStats = projectsData.projects.map(project => {
        const projectChunks = vectorStore.chunks.filter(chunk => chunk.project_id === project.id);
        const documentFiles = new Set(projectChunks.map(chunk => chunk.metadata.source_file));
        
        return {
          id: project.id,
          name: project.name,
          active: project.active,
          document_count: documentFiles.size,
          chunk_count: projectChunks.length
        };
      });

      return {
        ...vectorStore.stats,
        total_projects: projectsData.projects.length,
        projects: projectStats,
        embedding_model: vectorStore.embeddings_model,
        chunk_config: {
          size: vectorStore.chunk_size,
          overlap: vectorStore.overlap
        }
      };
    } catch (error) {
      logger.logRAG('get_stats_error', { error: error.message }, 'error');
      throw error;
    }
  }

  /**
   * Cleanup orphaned chunks (chunks without valid projects)
   * @returns {number} Number of cleaned up chunks
   */
  async cleanupOrphanedChunks() {
    try {
      const vectorStore = await this.loadVectorStore();
      const projectsData = await this.loadProjects();
      
      const validProjectIds = new Set(projectsData.projects.map(p => p.id));
      const initialCount = vectorStore.chunks.length;
      
      vectorStore.chunks = vectorStore.chunks.filter(chunk => 
        validProjectIds.has(chunk.project_id)
      );
      
      const cleanedCount = initialCount - vectorStore.chunks.length;
      
      if (cleanedCount > 0) {
        vectorStore.stats.total_chunks = vectorStore.chunks.length;
        await this.saveVectorStore(vectorStore);
        logger.logRAG('orphaned_chunks_cleaned', { cleanedCount });
      }
      
      return cleanedCount;
    } catch (error) {
      logger.logRAG('cleanup_orphaned_chunks_error', { error: error.message }, 'error');
      throw error;
    }
  }
}

// Create singleton instance
const vectorStore = new VectorStore();

export default vectorStore;