const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const crypto = require("crypto");
const { createWorker } = require("tesseract.js");
const { fromPath } = require("pdf2pic");

// Dynamic imports for ES modules (RAG services)
let ragService, promptGuard, vectorStore, embeddingService;
let securityMiddleware;

// Initialize ES modules
async function initializeRAGServices() {
  try {
    console.log('[RAG] Initializing RAG services...');
    
    const ragModule = await import('./services/ragService.js');
    ragService = ragModule.default;
    
    const promptGuardModule = await import('./services/promptGuard.js');
    promptGuard = promptGuardModule.default;
    
    const vectorStoreModule = await import('./services/vectorStore.js');
    vectorStore = vectorStoreModule.default;
    
    const embeddingModule = await import('./services/embeddingService.js');
    embeddingService = embeddingModule.default;
    
    const securityModule = await import('./middleware/security.js');
    securityMiddleware = securityModule;
    
    console.log('[RAG] ✅ RAG services initialized successfully');
    return true;
  } catch (error) {
    console.warn('[RAG] ⚠️ RAG services not available:', error.message);
    console.log('[RAG] Falling back to basic mode without RAG functionality');
    return false;
  }
}

const app = express();
app.use(express.json());
app.use(cors());

// Initialize RAG services
let ragEnabled = false;
initializeRAGServices().then(success => {
  ragEnabled = success;
  
  if (ragEnabled) {
    // Add security middleware
    app.use(securityMiddleware.securityHeaders());
    app.use(securityMiddleware.requestLogger());
    
    // Add rate limiting to sensitive endpoints
    app.use('/chat', securityMiddleware.rateLimiter({ limit: 20, windowMs: 60000 }));
    app.use('/chat-with-file', securityMiddleware.rateLimiter({ limit: 10, windowMs: 60000 }));
    app.use('/upload', securityMiddleware.rateLimiter({ limit: 5, windowMs: 60000 }));
  }
});

// HTTP request logging (optional)
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

const upload = multer({ dest: "uploads/" });
const OLLAMA_PATH = path.resolve(__dirname, "..", "resources", "ollama.exe");

console.log("OLLAMA_PATH:", OLLAMA_PATH, "exists?", fs.existsSync(OLLAMA_PATH));

const CACHE = new Map(); // { fileHash → extractedText }

async function hashFile(filePath) {
  const buf = await fsp.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function extractTextFromFile(filePath, originalName) {
  const ext = (path.extname(originalName || filePath) || "").toLowerCase();
  const hash = await hashFile(filePath);
  console.log(`[extractText] file=${originalName} ext=${ext} hash=${hash}`);

  if (CACHE.has(hash)) {
    console.log(`[extractText] cache hit for ${originalName}`);
    return CACHE.get(hash);
  }
  let text = "";
  try {
    if (ext === ".txt") {
      text = await fsp.readFile(filePath, "utf8");
    } else if (ext === ".docx") {
      const buffer = await fsp.readFile(filePath);
      const { value } = await mammoth.extractRawText({ buffer });
      text = value;
    } else if (ext === ".pdf") {
      console.log(`[extractText] parsing .pdf via pdf-parse: ${originalName}`);

      const buffer = await fsp.readFile(filePath);
      try {
        const parsed = await pdfParse(buffer);
        if (parsed.text?.trim().length > 50) {
          console.log(
            `[extractText] pdf-parse OK: ${parsed.text.length} chars`
          );

          text = parsed.text;
        } else {
          console.warn("[pdf] Not enough text — falling back to OCR");
          text = await ocrPdf(filePath);
        }
      } catch (e) {
        console.warn("[pdf-parse] failed — fallback to OCR:", e.message);
        text = await ocrPdf(filePath);
      }
    } else {
      console.log(`[extractText] treating as image → OCR: ${originalName}`);

      text = await ocrImage(filePath);
    }
  } catch (err) {
    console.error("[extractTextFromFile] failed:", err);
  }

  text = (text || "").trim();
  CACHE.set(hash, text);
  return text;
}

async function ocrImage(filePath) {
  console.log(`[ocrImage] start OCR on image: ${filePath}`);

  const worker = createWorker();
  try {
    await worker.load();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
    const {
      data: { text },
    } = await worker.recognize(filePath);
    console.log(`[ocrImage] recognized ${text.length} chars`);

    return text || "";
  } catch (err) {
    console.error("[ocrImage] ERROR:", err);
    throw err;
  } finally {
    await worker.terminate();
  }
}

async function ocrPdf(filePath, langs = "eng") {
  console.log(`[ocrPdf] start OCR on PDF: ${filePath}`);

  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  const converter = fromPath(filePath, {
    density: 300,
    saveFilename: `ocr-temp-${Date.now()}`,
    savePath: tempDir,
    format: "png",
    width: 1600,
    height: 1600,
  });

  const { path: pngPath } = await converter(1);
  console.log(`[ocrPdf] converted page 1 → ${pngPath}`);

  try {
    const text = await ocrImage(pngPath, langs);
    return text;
  } finally {
    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
    console.log(`[ocrPdf] cleaned up ${pngPath}`);
  }
}

/* ------------------------------ RAG ENHANCED ROUTES ------------------------------ */

// Enhanced upload route with RAG processing
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  try {
    // Apply security middleware if RAG is enabled
    if (ragEnabled && securityMiddleware) {
      await securityMiddleware.uploadSecurity()(req, res, () => {});
    }

    const text = await extractTextFromFile(
      req.file.path,
      req.file.originalname
    );

    // If RAG is enabled and project_id provided, process for RAG
    if (ragEnabled && req.body.project_id && text.length > 100) {
      console.log(`[RAG] Processing document for project: ${req.body.project_id}`);
      
      try {
        const result = await ragService.processDocument(
          text,
          req.body.project_id,
          {
            filename: req.file.originalname,
            file_type: path.extname(req.file.originalname),
            file_size: req.file.size,
            upload_date: new Date().toISOString()
          },
          {
            chunkSize: parseInt(req.body.chunk_size) || 500,
            overlap: parseInt(req.body.overlap) || 50,
            smartChunking: req.body.smart_chunking === 'true'
          }
        );

        await fsp.unlink(req.file.path).catch(() => {});
        
        return res.json({
          success: true,
          text,
          chars: text.length,
          rag: result
        });
      } catch (ragError) {
        console.error('[RAG] Document processing failed:', ragError.message);
        // Fall back to basic response
      }
    }

    await fsp.unlink(req.file.path).catch(() => {});
    res.json({ success: true, text, chars: text.length });
  } catch (err) {
    console.error("Upload extract failed:", err);
    res.status(500).json({ error: "Failed to extract text." });
  }
});

// Enhanced chat-with-file route with RAG context
app.post("/chat-with-file", upload.single("file"), async (req, res) => {
  console.log("[chat-with-file] → request received", {
    file: req.file?.originalname,
    model: req.body.model,
    message: req.body.message?.slice(0, 30) + "...",
  });
  
  const { model, message } = req.body;
  const file = req.file;
  
  if (!model || !message || !file) {
    console.warn("[chat-with-file] bad request", { model, message, file });
    return res
      .status(400)
      .json({ error: "Model, message, and file required." });
  }

  try {
    // Apply security check if available
    if (ragEnabled && promptGuard) {
      const securityResult = await promptGuard.checkSecurity(message, {
        ip: req.ip,
        endpoint: '/chat-with-file'
      });
      
      if (!securityResult.allowed) {
        console.warn('[SECURITY] Blocked chat-with-file request:', securityResult.reason);
        return res.status(400).json({
          error: 'Input rejected for security reasons',
          reason: securityResult.reason
        });
      }
    }

    // Extract & cleanup
    console.log("[chat-with-file] extracting text...");
    const parsedText = await extractTextFromFile(file.path, file.originalname);
    console.log("[chat-with-file] extracted text length:", parsedText.length);

    await fsp.unlink(file.path).catch(() => {});
    console.log("[chat-with-file] uploaded file deleted");

    let finalPrompt = message;

    // If RAG is enabled, try to get enhanced context
    if (ragEnabled && req.body.project_id) {
      try {
        console.log('[RAG] Getting enhanced context for query...');
        const contextResult = await ragService.enhancedRetrieve(message, {
          projectId: req.body.project_id,
          limit: 3,
          threshold: 0.1
        });

        if (contextResult.chunks.length > 0) {
          finalPrompt = `${message}\n\n---\nRelevant context from project documents:\n${contextResult.context}\n\n---\nCurrent file content:\n${parsedText}\n---`;
          console.log('[RAG] Enhanced prompt with RAG context');
        } else {
          finalPrompt = `${message}\n\n---\nContext from uploaded file (${file.originalname}):\n${parsedText}\n---`;
        }
      } catch (ragError) {
        console.error('[RAG] Context retrieval failed:', ragError.message);
        finalPrompt = `${message}\n\n---\nContext from uploaded file (${file.originalname}):\n${parsedText}\n---`;
      }
    } else {
      // Build the standard combined prompt
      finalPrompt = `${message}\n\n---\nContext from uploaded file (${file.originalname}):\n${parsedText}\n---`;
    }

    console.log("[chat-with-file] prompt preview:", finalPrompt.slice(0, 1000));

    // Delegate to your shared streaming helper
    return streamOllama(model, finalPrompt, res);
  } catch (err) {
    console.error("Failed in /chat-with-file:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Internal server error." });
    }
  }
});

// Enhanced chat route with RAG context retrieval
app.post("/chat", async (req, res) => {
  const { model, message, context, project_id } = req.body;
  if (!model || !message)
    return res.status(400).json({ error: "Model and message required." });

  try {
    // Apply security check if available
    if (ragEnabled && promptGuard) {
      const securityResult = await promptGuard.checkSecurity(message, {
        ip: req.ip,
        endpoint: '/chat'
      });
      
      if (!securityResult.allowed) {
        console.warn('[SECURITY] Blocked chat request:', securityResult.reason);
        return res.status(400).json({
          error: 'Input rejected for security reasons',
          reason: securityResult.reason
        });
      }
    }

    let finalPrompt = message;

    // If RAG is enabled, try to get relevant context
    if (ragEnabled && ragService) {
      try {
        console.log('[RAG] Retrieving context for user query...');
        const contextResult = await ragService.enhancedRetrieve(message, {
          projectId: project_id,
          limit: 5,
          threshold: 0.1
        });

        if (contextResult.chunks.length > 0) {
          console.log(`[RAG] Found ${contextResult.chunks.length} relevant chunks`);
          finalPrompt = `${message}\n\n---\nRelevant context from project documents:\n${contextResult.context}\n---`;
        } else if (context) {
          finalPrompt = `${message}\n\n---\nContext:\n${context}\n---`;
        }
      } catch (ragError) {
        console.error('[RAG] Context retrieval failed:', ragError.message);
        if (context) {
          finalPrompt = `${message}\n\n---\nContext:\n${context}\n---`;
        }
      }
    } else if (context) {
      finalPrompt = `${message}\n\n---\nContext:\n${context}\n---`;
    }

    return streamOllama(model, finalPrompt, res);
  } catch (err) {
    console.error("Failed in /chat:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Internal server error." });
    }
  }
});

/* ------------------------------ NEW RAG ENDPOINTS ------------------------------ */

// Get all projects
app.get("/api/projects", async (req, res) => {
  if (!ragEnabled) {
    return res.status(503).json({ error: "RAG service not available" });
  }

  try {
    const projects = await vectorStore.getProjects();
    res.json({ projects });
  } catch (error) {
    console.error("Get projects failed:", error);
    res.status(500).json({ error: "Failed to get projects" });
  }
});

// Create new project
app.post("/api/projects", async (req, res) => {
  if (!ragEnabled) {
    return res.status(503).json({ error: "RAG service not available" });
  }

  try {
    const project = await vectorStore.addProject(req.body);
    res.json({ project });
  } catch (error) {
    console.error("Create project failed:", error);
    res.status(500).json({ error: error.message || "Failed to create project" });
  }
});

// Get RAG system statistics
app.get("/api/rag/stats", async (req, res) => {
  if (!ragEnabled) {
    return res.status(503).json({ error: "RAG service not available" });
  }

  try {
    const stats = await ragService.getSystemStats();
    res.json(stats);
  } catch (error) {
    console.error("Get RAG stats failed:", error);
    res.status(500).json({ error: "Failed to get RAG statistics" });
  }
});

// Security report endpoint
app.get("/api/security/report", async (req, res) => {
  if (!ragEnabled || !promptGuard) {
    return res.status(503).json({ error: "Security service not available" });
  }

  try {
    const hours = parseInt(req.query.hours) || 24;
    const report = await promptGuard.generateSecurityReport(hours);
    res.json(report);
  } catch (error) {
    console.error("Security report failed:", error);
    res.status(500).json({ error: "Failed to generate security report" });
  }
});

// Search endpoint
app.post("/api/search", async (req, res) => {
  if (!ragEnabled) {
    return res.status(503).json({ error: "RAG service not available" });
  }

  try {
    const { query, project_id, limit = 5 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    const results = await ragService.retrieveContext(query, {
      projectId: project_id,
      limit,
      includeMetadata: true
    });

    res.json(results);
  } catch (error) {
    console.error("Search failed:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

/* ------------------------------ HELPERS ------------------------------ */
function stamp() {
  return new Date().toISOString();
}

function streamOllama(model, prompt, res) {
  console.log(`${stamp()} [streamOllama] spawning model "${model}"`);
  console.log(
    `${stamp()} [streamOllama] prompt length: ${prompt.length} chars`
  );

  try {
    const ollama = spawn(OLLAMA_PATH, ["run", model], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Handle "file not found" or permission errors
    ollama.on("error", (err) => {
      console.error("Failed to launch Ollama:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal: could not start Ollama." });
      }
    });

    ollama.stdin.write(prompt + "\n");
    ollama.stdin.end();

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    // after res.setHeader(...)
    res.write(
      JSON.stringify({ type: "status", text: "Ollama is loading the model…" }) +
        "\n"
    );

    let buffer = "";
    let isThinking = false;
    let thinking = "";

    ollama.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      buffer += text;

      if (text.includes("<think>")) {
        isThinking = true;
        thinking = "";
      }

      if (isThinking) {
        thinking += text;
      }

      if (text.includes("</think>")) {
        isThinking = false;
        res.write(
          JSON.stringify({
            type: "thinking",
            text: thinking.replace(/<\/?think>/g, ""),
          }) + "\n"
        );
      }
    });

    /* -------- collect stderr -------- */
    const spinnerRE = /^[\u2800-\u28FF]+$/; // braille progress glyphs

    let errBuf = "";
    ollama.stderr.on("data", (chunk) => {
      const txt = chunk.toString(); // << txt is now defined
      if (spinnerRE.test(txt.trim())) return; // ignore spinner frames
      errBuf += txt;
    });

    ollama.on("close", (code) => {
      if (errBuf.trim()) console.error("[ollama stderr]", errBuf);
    });

    ollama.stdout.on("end", () => {
      const final = buffer.replace(/<think>.*?<\/think>/s, "").trim();
      res.write(JSON.stringify({ type: "final", text: final }) + "\n");
      res.end();
    });

    ollama.stderr.on("data", (err) => {
      console.error("Ollama error:", err.toString());
    });
  } catch (error) {
    console.error("Failed to run Ollama:", error);
    res.status(500).json({ error: "Failed to invoke Ollama." });
  }
}

/* ------------------------------ ERROR HANDLING ------------------------------ */

// Add error handling middleware if RAG is enabled
if (ragEnabled && securityMiddleware) {
  app.use(securityMiddleware.errorHandler());
}

/* ------------------------------ LAUNCH ------------------------------ */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Server listening at http://localhost:${PORT}`);
  if (ragEnabled) {
    console.log(`🧠 RAG system enabled with security protection`);
  } else {
    console.log(`⚠️  RAG system disabled - running in basic mode`);
  }
});