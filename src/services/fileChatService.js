// src/services/fileChatService.js
import * as pdfjsLib from "pdfjs-dist/build/pdf";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import mammoth from "mammoth";

import { createWorker } from "tesseract.js";
import tesseractWorkerUrl from "tesseract.js/dist/worker.min.js?url";
import tesseractCoreUrl from "tesseract.js-core/tesseract-core.wasm.js?url";

// Tell PDF.js where to find its worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Initialize Electron IPC properly
let isElectron = true;
let ipcRenderer = null;

if (typeof window !== 'undefined' && window.require) {
  try {
    ipcRenderer = window.require('electron').ipcRenderer;
    isElectron = !!ipcRenderer;
  } catch (e) {
    console.warn('Not in Electron environment');
    isElectron = false;
  }
}
/**
 * Extract raw text from .txt, .docx, .pdf or via OCR fallback
 */
async function extractTextFromFile(file) {
  const name = file.name || "";
  const ext = name.split(".").pop().toLowerCase();

  // 1) plain text
  if (ext === "txt") {
    return (await file.text()).trim();
  }

  // 2) docx via mammoth
  if (ext === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return value.trim();
  }

  // 3) PDF via PDF.js
  if (ext === "pdf") {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = "";
    for (let i = 1; i <= pdf.numPages; ++i) {
      const page = await pdf.getPage(i);
      const { items } = await page.getTextContent();
      fullText += items.map((it) => it.str).join(" ") + "\n";
    }
    fullText = fullText.trim();
    if (fullText.length > 50) {
      return fullText;
    }
    // otherwise fall through to OCR
  }

  // 4) OCR fallback
  const worker = createWorker({
    workerPath: tesseractWorkerUrl,
    corePath: tesseractCoreUrl,
  });
  try {
    await worker.load();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");

    const {
      data: { text },
    } = await worker.recognize(file);
    return text.trim();
  } finally {
    await worker.terminate();
  }
}

async function doExtract(file) {
  if (isElectron && file.path) {
    // Only use file path if we're in Electron AND the file has a path property
    return ipc.invoke("extract-file-text", {
      filePath: file.path,
      fileName: file.name
    });
  } else {
    // For browser File objects, use buffer-based extraction
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    if (typeof window !== 'undefined' && window.require) {
      // We're in Electron - use IPC
      const { ipcRenderer } = window.require("electron");
      return ipcRenderer.invoke("extract-file-text-buffer", {
        fileName: file.name,
        buffer: Array.from(uint8Array)
      });
    } else {
      // We're in browser - use client-side extraction
      return extractTextFromFile(file);
    }
  }
}
/**
 * Stream a "chat with file" prompt straight into Ollama's /api/generate
 */
export async function chatWithFileStream(model, message, file, onMessage) {
  onMessage({ type: "status", text: "⏳ Extracting text from file…" });

  // 1) extract text
  const fileText = await doExtract(file);
  onMessage({
    type: "status",
    text: `✔️ Extracted ${fileText.length} characters`,
  });

  // 2) build the prompt
  const prompt = `
${message}

---
Context from file (${file.name}):
${fileText}
---`;
  onMessage({ type: "status", text: "Fine-tuned model is thinking…" });

  // 3) POST to Ollama
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt }),
  });
  if (!res.ok) throw new Error(`Ollama API error ${res.status}`);

  // 4) stream the NDJSON chunks
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop(); // partial line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        console.warn("Bad NDJSON chunk:", line);
      }
    }
  }
}
