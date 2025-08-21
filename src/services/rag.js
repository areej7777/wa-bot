// src/services/rag-ollama.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const INDEX = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "..", "data", "index.json"),
    "utf-8"
  )
);
const OLLAMA_EMB_URL =
  process.env.OLLAMA_EMB_URL || "http://127.0.0.1:11434/api/embeddings";
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";

async function embed(text) {
  const r = await axios.post(
    OLLAMA_EMB_URL,
    { model: EMBED_MODEL, prompt: text },
    { timeout: 20000 }
  );
  return r.data?.embedding || r.data?.data?.[0];
}

function cosine(a, b) {
  let s = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return s / (Math.sqrt(na) * Math.sqrt(nb));
}

async function makeContext(query, k = 4) {
  const q = await embed(query);
  const scored = INDEX.map((it) => ({ ...it, score: cosine(q, it.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return {
    text: scored.map((s) => `# ${s.file}\n${s.text}`).join("\n\n---\n\n"),
    score: scored[0]?.score || 0,
  };
}

module.exports = { makeContext };
