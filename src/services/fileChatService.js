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
  if (isElectron && ipcRenderer) {
    try {
      // First try file path if available (more efficient)
      if (file.path) {
        return await ipcRenderer.invoke("extract-file-text", {
          filePath: file.path,
          fileName: file.name
        });
      } else {
        // Fallback to buffer-based extraction
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        return await ipcRenderer.invoke("extract-file-text-buffer", {
          fileName: file.name,
          buffer: Array.from(uint8Array)
        });
      }
    } catch (error) {
      console.warn('IPC extraction failed, falling back to client-side:', error);
      return extractTextFromFile(file);
    }
  } else {
    // Browser environment - use client-side extraction
    return extractTextFromFile(file);
  }
}
/**
 * Stream a "chat with file" prompt through Express backend
 */
export async function chatWithFileStream(model, message, file, onMessage) {
  onMessage({ type: "status", text: "⏳ Uploading file to backend..." });

  // Create FormData to send file to Express backend
  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', model);
  formData.append('message', message);

  try {
    // POST to Express backend /chat-with-file endpoint
    const res = await fetch("http://localhost:5000/chat-with-file", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Backend error ${res.status}: ${await res.text()}`);
    }

    // Stream the NDJSON response from Express
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep partial line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          onMessage(parsed);
        } catch (error) {
          console.warn("Bad NDJSON chunk:", line, error);
        }
      }
    }
  } catch (error) {
    console.error("chatWithFileStream error:", error);
    onMessage({ 
      type: "final", 
      text: `Error: ${error.message || 'Failed to process file with backend'}` 
    });
  }
}
