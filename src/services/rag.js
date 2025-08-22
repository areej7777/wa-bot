// src/services/rag.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const INDEX_PATH = path.join(__dirname, "../data/kb.index.json");
const INDEX = fs.existsSync(INDEX_PATH)
  ? JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"))
  : [];

const OLLAMA_EMBED =
  process.env.OLLAMA_EMBED || "http://127.0.0.1:11434/api/embeddings";
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";

// نفس التطبيع للأرقام
function normalizeDigits(s) {
  const map = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
  };
  return (s || "").replace(/[٠-٩]/g, (d) => map[d]);
}

async function embed(q) {
  const r = await axios.post(OLLAMA_EMBED, {
    model: EMBED_MODEL,
    prompt: normalizeDigits(q),
  });
  return r.data?.embedding;
}

function cosine(a, b) {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

async function retrieve(query, k = 3) {
  if (!INDEX.length) return [];
  const q = await embed(query);
  return INDEX.map((it) => ({ ...it, score: cosine(q, it.emb) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}

async function makeContext(query, { k = 3, sep = "\n---\n" } = {}) {
  const hits = await retrieve(query, k);
  const text = hits.map((h) => `${h.title}\n${h.text}`).join(sep);
  const best = hits[0]?.score ?? 0;
  return { text, score: best, hits };
}

module.exports = { retrieve, makeContext };
