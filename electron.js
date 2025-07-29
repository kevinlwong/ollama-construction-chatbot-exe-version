/* ──────────────────────────────────────────────
   electron.js – main-process entry
   ──────────────────────────────────────────── */

const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { extractTextFromFile } = require("./backend/extract.cjs");

// Global error handling
process.on('uncaughtException', (error) => {
  console.error('[CRASH] Uncaught Exception:', error);
  console.error('[CRASH] Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRASH] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Import Express and setup backend in main process
let express, cors, multer, expressApp;
try {
  express = require("express");
  cors = require("cors");
  multer = require("multer");
  expressApp = express();
  console.log("[startup] Express modules loaded successfully");
} catch (error) {
  console.error("[startup] Failed to load Express modules:", error);
}

const isDev = process.env.NODE_ENV === "development";
const rootDir = isDev
  ? __dirname // repo root while developing
  : process.resourcesPath; // <installDir>\resources

/* absolute paths we need in BOTH modes */
const OLLAMA_EXE = isDev 
  ? path.join(rootDir, "resources", "ollama.exe")
  : path.join(rootDir, "ollama.exe");
const BACKEND_CJS = isDev 
  ? path.join(rootDir, "backend", "server.cjs")
  : path.join(process.resourcesPath, "app.asar.unpacked", "backend", "server.cjs");
const INDEX_HTML = path.join(rootDir, "dist", "index.html");
const ICON_ICO = path.join(rootDir, "public", "icon.ico");

/* quick sanity check in prod */
if (!isDev) {
  [
    ["ollama", OLLAMA_EXE],
    ["backend", BACKEND_CJS],
    ["index", INDEX_HTML],
  ].forEach(([n, p]) =>
    console.log(`[check] ${n.padEnd(7)} exists=${fs.existsSync(p)}`)
  );
}

let mainWin, ollamaProc, expressServer;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
}

/* spawn-and-log helper */
function run(name, cmd, args, opts = {}) {
  console.log(`[spawn] ${name}: ${cmd} ${args.join(" ")}`);
  console.log(`[spawn] ${name}: cwd = ${opts.cwd}`);
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  p.stdout.on("data", (d) => console.log(`[${name}]`, d.toString().trimEnd()));
  p.stderr.on("data", (d) =>
    console.error(`[${name}!]`, d.toString().trimEnd())
  );
  p.on("close", (c) => console.log(`[${name}] exited with code (${c})`));
  p.on("error", (err) => console.error(`[${name}] spawn failed:`, err.message));
  return p;
}

/* ───── Express Server Setup in Main Process ───── */
function setupExpressServer() {
  if (!express || !cors || !multer || !expressApp) {
    console.error("[express] Express modules not loaded, skipping server setup");
    return;
  }
  
  try {
    console.log("[express] Setting up Express server in main process...");
    
    // Create temp directory in user's temp folder (works in packaged apps)
    const os = require('os');
    const tempDir = path.join(os.tmpdir(), "ollama-chatbot-temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    console.log("[express] Using temp directory:", tempDir);
    
    // Middleware
    expressApp.use(express.json());
    expressApp.use(cors());
    expressApp.use((req, res, next) => {
      console.log(`[express] ${req.method} ${req.url}`);
      next();
    });
    
    const upload = multer({ dest: tempDir });
  
  // Routes
  expressApp.post("/chat-with-file", upload.single("file"), async (req, res) => {
    console.log("[express] /chat-with-file request received");
    const { model, message } = req.body;
    const file = req.file;
    
    if (!model || !message || !file) {
      return res.status(400).json({ error: "Model, message, and file required." });
    }
    
    try {
      // Set streaming headers
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Transfer-Encoding", "chunked");
      
      // Send status updates
      res.write(JSON.stringify({ type: "status", text: "⏳ Extracting text from file..." }) + "\n");
      
      console.log(`[extract] Starting extraction for: ${file.originalname} (${file.size} bytes)`);
      
      // Add timeout for extraction (max 2 minutes)
      const extractionPromise = extractTextFromFile(file.path, file.originalname);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Extraction timeout after 2 minutes")), 120000)
      );
      
      const parsedText = await Promise.race([extractionPromise, timeoutPromise]);
      console.log(`[extract] Completed extraction: ${parsedText.length} characters`);
      
      res.write(JSON.stringify({ type: "status", text: `✔️ Extracted ${parsedText.length} characters` }) + "\n");
      
      // Clean up temp file
      fs.unlinkSync(file.path);
      
      // Build prompt
      const prompt = `${message}\n\n---\nContext from uploaded file (${file.originalname}):\n${parsedText}\n---`;
      
      res.write(JSON.stringify({ type: "status", text: "Fine-tuned model is thinking..." }) + "\n");
      
      // Stream Ollama response
      streamOllamaInMain(model, prompt, res);
      
    } catch (err) {
      console.error("[express] Error in /chat-with-file:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });
  
  // Regular chat endpoint
  expressApp.post("/chat", async (req, res) => {
    const { model, message, context } = req.body;
    if (!model || !message) {
      return res.status(400).json({ error: "Model and message required." });
    }
    
    const finalPrompt = context ? `${message}\n\n---\nContext:\n${context}\n---` : message;
    
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    
    streamOllamaInMain(model, finalPrompt, res);
  });
  
    // Start server
    expressServer = expressApp.listen(5000, () => {
      console.log("[express] ✅ Express server running on http://localhost:5000");
    });
    
  } catch (error) {
    console.error("[express] Failed to setup Express server:", error);
    console.error("[express] Stack:", error.stack);
  }
}

/* ───── Ollama Streaming Helper ───── */
function streamOllamaInMain(model, prompt, res) {
  console.log(`[ollama] Starting model "${model}"`);
  
  const ollama = spawn(OLLAMA_EXE, ["run", model], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: path.dirname(OLLAMA_EXE),
  });
  
  ollama.on("error", (err) => {
    console.error("[ollama] Failed to launch:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Could not start Ollama." });
    }
  });
  
  ollama.stdin.write(prompt + "\n");
  ollama.stdin.end();
  
  res.write(JSON.stringify({ type: "status", text: "Ollama is loading the model…" }) + "\n");
  
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
      res.write(JSON.stringify({
        type: "thinking",
        text: thinking.replace(/<\/?think>/g, ""),
      }) + "\n");
    }
  });
  
  ollama.stdout.on("end", () => {
    const final = buffer.replace(/<think>.*?<\/think>/s, "").trim();
    res.write(JSON.stringify({ type: "final", text: final }) + "\n");
    res.end();
  });
  
  ollama.stderr.on("data", (err) => {
    console.error("[ollama] Error:", err.toString());
  });
}

/* ───── create renderer window ───── */
function createWindow() {
  mainWin = new BrowserWindow({
    width: 1100,
    height: 820,
    title: "Bronco Vision",
    icon: fs.existsSync(ICON_ICO) ? ICON_ICO : undefined,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  if (isDev) {
    mainWin.loadURL("http://localhost:5173");
  } else {
    /*  __dirname inside electron.js == root of app.asar  */
    const prodIndex = path.join(__dirname, "dist", "index.html");
    console.log("[main] loadFile →", prodIndex);
    mainWin.loadFile(prodIndex); // <-- the important change
  }

  /* keep title stable */
  mainWin.on("page-title-updated", (e) => e.preventDefault());

  /* handle window closed */
  mainWin.on('closed', () => {
    mainWin = null;
  });

  /* open devtools automatically in dev */
  if (isDev) {
    mainWin.webContents.once("did-frame-finish-load", () =>
      mainWin.webContents.openDevTools({ mode: "detach" })
    );
  }
}

/* ───── app lifecycle ───── */
app.whenReady().then(async () => {
  /* 1 / 3  Ollama local model server (port 11434) */
  try {
    // Test if Ollama is already running
    const response = await fetch('http://localhost:11434/api/tags');
    console.log("[ollama] Ollama already running, skipping startup");
  } catch (error) {
    console.log("[ollama] Ollama not running, starting it...");
    ollamaProc = run("ollama", OLLAMA_EXE, ["serve"], {
      cwd: path.dirname(OLLAMA_EXE),
    });
  }

  /* 2 / 3  Your Express / OCR backend (port 5000) */
  try {
    setupExpressServer();
  } catch (error) {
    console.error("[main] Express setup failed, continuing without backend server:", error);
  }

  /* 3 / 3  Create the renderer window */
  // Give backend a moment to start before creating window
  setTimeout(() => {
    createWindow();
  }, 2000);
});

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (mainWin === null) {
    createWindow();
  }
});

app.on("before-quit", () => {
  // graceful shutdown
  console.log("[main] Shutting down express server and ollama processes...");
  expressServer?.close(() => {
    console.log("[express] Server closed");
  });
  ollamaProc?.kill();
});

ipcMain.handle("extract-file-text", async (event, { filePath, fileName }) => {
  try {
    return await extractTextFromFile(filePath, fileName);
  } catch (err) {
    console.error("extract failed:", err);
    throw err;
  }
});

ipcMain.handle(
  "extract-file-text-buffer",
  async (event, { fileName, buffer }) => {
    const nodeBuffer = Buffer.from(buffer); // Restore Node.js Buffer
    const { extractTextFromBuffer } = require("./backend/extract.cjs");
    return await extractTextFromBuffer(nodeBuffer, fileName);
  }
);

/* ───── simple IPC helper (unchanged) ───── */
ipcMain.handle(
  "ollama-request",
  (_, { model, prompt }) =>
    new Promise((ok, err) => {
      const p = spawn(OLLAMA_EXE, ["run", model, prompt], {
        cwd: path.dirname(OLLAMA_EXE),
      });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("close", () => ok(out));
      p.on("error", err);
    })
);
