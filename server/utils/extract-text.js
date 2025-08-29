// server/utils/extract-text.js
import path from "path";
import fs from "fs/promises";
import pdf from "pdf-parse";
import mammoth from "mammoth";

export async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const data = await pdf(await fs.readFile(filePath));
    return data.text;
  }

  if (ext === ".docx") {
    const buf = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value || "";
  }

  if (ext === ".md" || ext === ".txt") {
    return await fs.readFile(filePath, "utf8");
  }

  // fallback: try reading as text
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
