// backend/extract.js
const fs = require("fs/promises");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const crypto = require("crypto");
const Tesseract = require("tesseract.js");

const CACHE = new Map();

async function hashFile(path) {
  const buf = await fs.readFile(path);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function extractTextFromBuffer(buffer, fileName) {
  const ext = fileName.split(".").pop().toLowerCase();
  let text = "";
  console.log(
    "[extractTextFromBuffer] extension:",
    ext,
    "size:",
    buffer.length
  );

  try {
    if (ext === "txt") {
      text = buffer.toString("utf8");
    } else if (ext === "docx") {
      text = (await mammoth.extractRawText({ buffer })).value;
    } else if (ext === "pdf") {
      const parsed = await pdfParse(buffer);
      if (parsed.text.trim().length > 50) {
        text = parsed.text;
      } else {
        console.log("[extractTextFromBuffer] PDF text insufficient, OCR not supported");
        text = `[Note: This PDF appears to be image-based. OCR is not available in the packaged version.]`;
      }
    } else {
      console.log("[extractTextFromBuffer] Image file, OCR not supported");
      text = `[Note: This appears to be an image file. OCR is not available in the packaged version.]`;
    }
  } catch (error) {
    console.error("[extractTextFromBuffer] Error:", error);
    throw error;
  }

  return text.trim();
}

async function extractTextFromFile(filePath, originalName) {
  const ext = (originalName || filePath).split(".").pop().toLowerCase();
  console.log(`[extract] Processing file: ${originalName}, extension: ${ext}`);
  
  const key = await hashFile(filePath);
  if (CACHE.has(key)) {
    console.log(`[extract] Cache hit for: ${originalName}`);
    return CACHE.get(key);
  }

  let text = "";
  console.log(`[extract] Starting extraction for type: ${ext}`);
  
  if (ext === "txt") {
    console.log(`[extract] Reading text file`);
    text = await fs.readFile(filePath, "utf8");
  } else if (ext === "docx") {
    console.log(`[extract] Processing DOCX file`);
    const buf = await fs.readFile(filePath);
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (ext === "pdf") {
    console.log(`[extract] Processing PDF file`);
    const buf = await fs.readFile(filePath);
    const parsed = await pdfParse(buf);
    if (parsed.text.trim().length > 50) {
      console.log(`[extract] PDF text extraction successful: ${parsed.text.length} chars`);
      text = parsed.text;
    } else {
      console.log(`[extract] PDF text insufficient, skipping OCR (not supported in packaged app)`);
      text = `[Note: This PDF appears to be image-based. OCR is not available in the packaged version. Please extract text manually or use a text-based PDF.]`;
    }
  } else {
    console.log(`[extract] Image file detected, OCR not supported in packaged app`);
    text = `[Note: This appears to be an image file (${ext}). OCR is not available in the packaged version. Please convert to text format first.]`;
  }

  text = text.trim();
  console.log(`[extract] Final text length: ${text.length} characters`);
  CACHE.set(key, text);
  return text;
}

async function ocrImage(buffer) {
  console.log(`[ocr] Starting OCR on ${buffer.length} byte buffer`);
  
  try {
    console.log(`[ocr] Using Tesseract.recognize directly...`);
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng', {
      logger: m => console.log(`[tesseract] ${m.status}: ${m.progress || 0}`)
    });
    console.log(`[ocr] Recognition complete: ${text.length} characters`);
    return text;
  } catch (error) {
    console.error(`[ocr] Tesseract failed:`, error);
    throw error;
  }
}

module.exports = {
  extractTextFromFile,
  extractTextFromBuffer,
};
