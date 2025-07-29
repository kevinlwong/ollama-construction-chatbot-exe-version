// backend/extract.js
const fs = require("fs/promises");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const crypto = require("crypto");
const { createWorker } = require("tesseract.js");

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

  if (ext === "txt") {
    text = buffer.toString("utf8");
  } else if (ext === "docx") {
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (ext === "pdf") {
    const parsed = await pdfParse(buffer);
    text = parsed.text;
  } else {
    text = await ocrImage(buffer);
  }

  return text.trim();
}

async function extractTextFromFile(filePath, originalName) {
  const ext = (originalName || filePath).split(".").pop().toLowerCase();
  const key = await hashFile(filePath);
  if (CACHE.has(key)) return CACHE.get(key);

  let text = "";
  if (ext === "txt") {
    text = await fs.readFile(filePath, "utf8");
  } else if (ext === "docx") {
    const buf = await fs.readFile(filePath);
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (ext === "pdf") {
    const buf = await fs.readFile(filePath);
    const parsed = await pdfParse(buf);
    if (parsed.text.trim().length > 50) {
      text = parsed.text;
    } else {
      // fallback to OCR
      text = await ocrImage(buf);
    }
  } else {
    text = await ocrImage(await fs.readFile(filePath));
  }

  text = text.trim();
  CACHE.set(key, text);
  return text;
}

async function ocrImage(buffer) {
  const worker = createWorker();
  await worker.load();
  await worker.loadLanguage("eng");
  await worker.initialize("eng");
  const {
    data: { text },
  } = await worker.recognize(buffer);
  await worker.terminate();
  return text;
}

module.exports = {
  extractTextFromFile,
  extractTextFromBuffer,
};
