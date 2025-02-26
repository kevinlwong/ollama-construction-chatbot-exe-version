const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

const isDev = process.env.NODE_ENV === "development";

const ollamaPath = isDev
  ? path.join(__dirname, "resources", "ollama.exe") // Dev Mode
  : path.join(process.resourcesPath, "resources", "ollama.exe"); // Prod Mode

let mainWindow;

app.whenReady().then(() => {
  console.log("Launching Electron App...");

  const ollamaProcess = spawn(ollamaPath, ["serve"], {
    cwd: path.dirname(ollamaPath),
    detached: true,
    stdio: "ignore",
  });

  ollamaProcess.on("error", (err) => {
    console.error("Failed to start Ollama:", err);
  });

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    title: "Construction Chatbot",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Required for Electron-Renderer communication
    },
  });
  icon: path.join(__dirname, "public/icon.ico"); // ← Taskbar icon

  const startURL = isDev
    ? "http://localhost:5173"
    : `file://${path.join(__dirname, "dist", "index.html")}`;

  mainWindow.loadURL(startURL);

  // Optional: Force title to stay consistent
  mainWindow.on("page-title-updated", (e) => {
    e.preventDefault();
  });

  app.on("window-all-closed", () => {
    ollamaProcess.kill();
    app.quit();
  });
});

// Handle Chatbot Messages
ipcMain.handle("ollama-request", async (event, { model, prompt }) => {
  return new Promise((resolve, reject) => {
    const ollama = spawn(ollamaPath, ["run", model, prompt]);

    let response = "";
    ollama.stdout.on("data", (data) => {
      response += data.toString();
    });

    ollama.on("close", () => resolve(response));
    ollama.on("error", (err) => reject(err));
  });
});
