/* ──────────────────────────────────────────────
   electron.js – main-process entry
   ──────────────────────────────────────────── */

const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { extractTextFromFile } = require("./backend/extract.cjs");

const isDev = process.env.NODE_ENV === "development";
const rootDir = isDev
  ? __dirname // repo root while developing
  : process.resourcesPath; // <installDir>\resources
/* absolute paths we need in BOTH modes */
const OLLAMA_EXE = path.join(
  rootDir,
  "dist_electron/win-unpacked/resources",
  "ollama.exe"
); // one “resources”!
const BACKEND_CJS = path.join(rootDir, "backend", "server.cjs");
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

let mainWin, ollamaProc, backendProc;

/* spawn-and-log helper */
function run(name, cmd, args, opts = {}) {
  console.log(`[spawn] ${name}: ${cmd} ${args.join(" ")}`);
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  p.stdout.on("data", (d) => console.log(`[${name}]`, d.toString().trimEnd()));
  p.stderr.on("data", (d) =>
    console.error(`[${name}!]`, d.toString().trimEnd())
  );
  p.on("close", (c) => console.log(`[${name}] exited (${c})`));
  p.on("error", (err) => console.error(`[${name}] failed:`, err));
  return p;
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

  /* open devtools automatically in dev */
  if (isDev) {
    mainWin.webContents.once("did-frame-finish-load", () =>
      mainWin.webContents.openDevTools({ mode: "detach" })
    );
  }
}

/* ───── app lifecycle ───── */
app.whenReady().then(() => {
  /* 1 / 3  Ollama local model server (port 11434) */
  ollamaProc = run("ollama", OLLAMA_EXE, ["serve"], {
    cwd: path.dirname(OLLAMA_EXE),
  });

  /* 2 / 3  Your Express / OCR backend (port 5000) */
  backendProc = run("backend", process.execPath, [BACKEND_CJS], {
    cwd: path.dirname(BACKEND_CJS),
  });

  /* 3 / 3  Create the renderer window */
  createWindow();
});

app.on("before-quit", () => {
  // graceful shutdown
  backendProc?.kill();
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
