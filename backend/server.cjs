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

const app = express();
app.use(express.json());
app.use(cors());
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

/* ------------------------------ ROUTES ------------------------------ */

// POST /upload — just extract
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  try {
    const text = await extractTextFromFile(
      req.file.path,
      req.file.originalname
    );
    await fsp.unlink(req.file.path).catch(() => {});
    res.json({ success: true, text, chars: text.length });
  } catch (err) {
    console.error("Upload extract failed:", err);
    res.status(500).json({ error: "Failed to extract text." });
  }
});

// POST /chat-with-file — file upload + streaming chat
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
    // Set streaming headers first
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    
    // Send status updates during file processing
    res.write(JSON.stringify({ type: "status", text: "⏳ Extracting text from file..." }) + "\n");
    
    // Extract & cleanup
    console.log("[chat-with-file] extracting text...");
    const parsedText = await extractTextFromFile(file.path, file.originalname);
    console.log("[chat-with-file] extracted text length:", parsedText.length);

    res.write(JSON.stringify({ type: "status", text: `✔️ Extracted ${parsedText.length} characters` }) + "\n");
    
    await fsp.unlink(file.path).catch(() => {});
    console.log("[chat-with-file] uploaded file deleted");

    res.write(JSON.stringify({ type: "status", text: "Fine-tuned model is thinking..." }) + "\n");

    // Build the combined prompt
    const prompt =
      `${message}\n\n---\n` +
      `Context from uploaded file (${file.originalname}):\n` +
      `${parsedText}\n---`;

    console.log("[chat-with-file] prompt preview:", prompt.slice(0, 1000));

    // Delegate to your shared streaming helper
    return streamOllama(model, prompt, res);
  } catch (err) {
    console.error("Failed in /chat-with-file:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Internal server error." });
    }
  }
});

// POST /chat — text-only prompt + optional context
app.post("/chat", async (req, res) => {
  const { model, message, context } = req.body;
  if (!model || !message)
    return res.status(400).json({ error: "Model and message required." });

  const finalPrompt = context
    ? `${message}\n\n---\nContext:\n${context}\n---`
    : message;
  return streamOllama(model, finalPrompt, res);
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

    // Handle “file not found” or permission errors
    ollama.on("error", (err) => {
      console.error("Failed to launch Ollama:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal: could not start Ollama." });
      }
    });

    ollama.stdin.write(prompt + "\n");
    ollama.stdin.end();

    // Only set headers if not already set (for direct /chat endpoint)
    if (!res.headersSent && !res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Transfer-Encoding", "chunked");
    }
    
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

/* ------------------------------ LAUNCH ------------------------------ */

app.listen(5000, () =>
  console.log("✅ Server listening at http://localhost:5000")
);
