/**
 * Text chunking utilities for RAG document processing
 */

/**
 * Split text into chunks with specified size and overlap
 * @param {string} text - Input text to chunk
 * @param {Object} options - Chunking options
 * @param {number} options.chunkSize - Maximum tokens per chunk (default: 500)
 * @param {number} options.overlap - Overlap tokens between chunks (default: 50)
 * @param {string} options.separator - Separator to use (default: sentence)
 * @returns {Array<Object>} Array of chunk objects
 */
export function chunkText(text, options = {}) {
  const {
    chunkSize = 500,
    overlap = 50,
    separator = 'sentence'
  } = options;

  if (!text || typeof text !== 'string') {
    return [];
  }

  // Clean and normalize text
  const cleanText = text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  let chunks = [];

  if (separator === 'sentence') {
    chunks = chunkBySentence(cleanText, chunkSize, overlap);
  } else if (separator === 'paragraph') {
    chunks = chunkByParagraph(cleanText, chunkSize, overlap);
  } else {
    chunks = chunkByWords(cleanText, chunkSize, overlap);
  }

  return chunks.map((chunk, index) => ({
    index,
    text: chunk.trim(),
    tokenCount: estimateTokenCount(chunk),
    wordCount: chunk.split(/\s+/).length,
    charCount: chunk.length
  }));
}

/**
 * Chunk text by sentences, respecting sentence boundaries
 * @param {string} text - Input text
 * @param {number} chunkSize - Target chunk size
 * @param {number} overlap - Overlap size
 * @returns {string[]} Array of text chunks
 */
function chunkBySentence(text, chunkSize, overlap) {
  // Split by sentence endings, preserving the punctuation
  const sentences = text.match(/[^\.!?]+[\.!?]+/g) || [text];
  const chunks = [];
  let currentChunk = '';
  let currentTokens = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    const sentenceTokens = estimateTokenCount(sentence);

    // If adding this sentence would exceed chunk size, finalize current chunk
    if (currentTokens + sentenceTokens > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      
      // Create overlap by including last few sentences
      const overlapText = createOverlap(sentences, i, overlap);
      currentChunk = overlapText;
      currentTokens = estimateTokenCount(overlapText);
    }

    currentChunk += (currentChunk ? ' ' : '') + sentence;
    currentTokens += sentenceTokens;
  }

  // Add final chunk if not empty
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Chunk text by paragraphs
 * @param {string} text - Input text
 * @param {number} chunkSize - Target chunk size
 * @param {number} overlap - Overlap size
 * @returns {string[]} Array of text chunks
 */
function chunkByParagraph(text, chunkSize, overlap) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  const chunks = [];
  let currentChunk = '';
  let currentTokens = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i].trim();
    const paragraphTokens = estimateTokenCount(paragraph);

    if (currentTokens + paragraphTokens > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      
      // Create overlap
      const overlapText = createParagraphOverlap(paragraphs, i, overlap);
      currentChunk = overlapText;
      currentTokens = estimateTokenCount(overlapText);
    }

    currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    currentTokens += paragraphTokens;
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Simple word-based chunking fallback
 * @param {string} text - Input text
 * @param {number} chunkSize - Target chunk size
 * @param {number} overlap - Overlap size
 * @returns {string[]} Array of text chunks
 */
function chunkByWords(text, chunkSize, overlap) {
  const words = text.split(/\s+/);
  const chunks = [];
  const wordsPerToken = 0.75; // Rough estimate
  const targetWords = Math.floor(chunkSize * wordsPerToken);
  const overlapWords = Math.floor(overlap * wordsPerToken);

  for (let i = 0; i < words.length; i += targetWords - overlapWords) {
    const chunk = words.slice(i, i + targetWords).join(' ');
    if (chunk.trim()) {
      chunks.push(chunk.trim());
    }
  }

  return chunks;
}

/**
 * Create overlap text from previous sentences
 * @param {string[]} sentences - Array of sentences
 * @param {number} currentIndex - Current sentence index
 * @param {number} overlapSize - Desired overlap size in tokens
 * @returns {string} Overlap text
 */
function createOverlap(sentences, currentIndex, overlapSize) {
  let overlap = '';
  let tokens = 0;
  
  for (let i = currentIndex - 1; i >= 0; i--) {
    const sentence = sentences[i];
    const sentenceTokens = estimateTokenCount(sentence);
    
    if (tokens + sentenceTokens > overlapSize) {
      break;
    }
    
    overlap = sentence + ' ' + overlap;
    tokens += sentenceTokens;
  }
  
  return overlap.trim();
}

/**
 * Create overlap text from previous paragraphs
 * @param {string[]} paragraphs - Array of paragraphs
 * @param {number} currentIndex - Current paragraph index
 * @param {number} overlapSize - Desired overlap size in tokens
 * @returns {string} Overlap text
 */
function createParagraphOverlap(paragraphs, currentIndex, overlapSize) {
  let overlap = '';
  let tokens = 0;
  
  for (let i = currentIndex - 1; i >= 0; i--) {
    const paragraph = paragraphs[i];
    const paragraphTokens = estimateTokenCount(paragraph);
    
    if (tokens + paragraphTokens > overlapSize) {
      break;
    }
    
    overlap = paragraph + '\n\n' + overlap;
    tokens += paragraphTokens;
  }
  
  return overlap.trim();
}

/**
 * Estimate token count for text (rough approximation)
 * @param {string} text - Input text
 * @returns {number} Estimated token count
 */
export function estimateTokenCount(text) {
  if (!text) return 0;
  
  // Rough estimation: ~4 characters per token for English text
  // This is a conservative estimate for safety
  return Math.ceil(text.length / 4);
}

/**
 * Smart text chunking that preserves context
 * @param {string} text - Input text
 * @param {Object} options - Chunking options
 * @returns {Array<Object>} Array of enhanced chunk objects
 */
export function smartChunk(text, options = {}) {
  const chunks = chunkText(text, options);
  
  return chunks.map((chunk, index) => ({
    ...chunk,
    id: `chunk_${index}`,
    type: detectChunkType(chunk.text),
    summary: generateChunkSummary(chunk.text),
    keywords: extractKeywords(chunk.text)
  }));
}

/**
 * Detect the type of content in a chunk
 * @param {string} text - Chunk text
 * @returns {string} Content type
 */
function detectChunkType(text) {
  const lower = text.toLowerCase();
  
  if (lower.includes('table') || lower.includes('schedule') || /\d+[\s]*[%$]/.test(text)) {
    return 'data';
  }
  if (lower.includes('section') || lower.includes('article') || lower.includes('code')) {
    return 'regulatory';
  }
  if (lower.includes('material') || lower.includes('specification') || lower.includes('property')) {
    return 'technical';
  }
  if (lower.includes('safety') || lower.includes('warning') || lower.includes('caution')) {
    return 'safety';
  }
  
  return 'general';
}

/**
 * Generate a brief summary of chunk content
 * @param {string} text - Chunk text
 * @returns {string} Brief summary
 */
function generateChunkSummary(text) {
  // Take first sentence or first 100 characters
  const firstSentence = text.match(/^[^\.!?]+[\.!?]+/);
  if (firstSentence) {
    return firstSentence[0].trim();
  }
  
  return text.substring(0, 100) + (text.length > 100 ? '...' : '');
}

/**
 * Extract key terms from chunk text
 * @param {string} text - Chunk text
 * @returns {string[]} Array of keywords
 */
function extractKeywords(text) {
  // Simple keyword extraction - can be enhanced later
  const commonWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those'
  ]);

  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !commonWords.has(word));

  // Return unique words, limited to top 10
  return [...new Set(words)].slice(0, 10);
}