// scripts/ingest.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const KB_DIR = path.join(__dirname, "..", "data", "docs");
const INDEX_OUT = path.join(__dirname, "..", "data", "index.json");
const OLLAMA_EMB_URL =
  process.env.OLLAMA_EMB_URL || "http://172.17.0.1:11434/api/embeddings";
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";

async function embed(text) {
  const r = await axios.post(
    OLLAMA_EMB_URL,
    { model: EMBED_MODEL, prompt: text },
    { timeout: 30000 }
  );
  return r.data?.embedding || r.data?.data?.[0];
}

function chunk(text, size = 500, overlap = 50) {
  const out = [];
  for (let i = 0; i < text.length; i += size - overlap)
    out.push(text.slice(i, i + size));
  return out;
}

(async () => {
  const files = fs
    .readdirSync(KB_DIR)
    .filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
  const index = [];
  for (const f of files) {
    const full = fs.readFileSync(path.join(KB_DIR, f), "utf-8");
    for (const c of chunk(full)) {
      const vec = await embed(c);
      index.push({ file: f, text: c, vec });
      process.stdout.write(".");
    }
  }
  fs.writeFileSync(INDEX_OUT, JSON.stringify(index), "utf-8");
  console.log(`\nSaved ${index.length} chunks to ${INDEX_OUT}`);
})();
