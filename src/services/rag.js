// src/services/rag.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// المسار الصحيح للفهرس من داخل src/services/ إلى data/index.json
const INDEX_PATH = path.resolve(__dirname, "..", "..", "data", "index.json");

// حمّل الفهرس الخام (قد يكون {file,text,vec} أو {title,text,emb} أو {text,embedding}..)
const RAW_INDEX = fs.existsSync(INDEX_PATH)
  ? JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"))
  : [];

// طَبِّع البنية إلى شكل موحّد داخليًا: { id, source, title, text, emb }
const INDEX = (Array.isArray(RAW_INDEX) ? RAW_INDEX : [])
  .map((it, i) => {
    const id = it.id || `${it.file || it.title || "chunk"}#${i}`;
    const title = it.title || it.file || "untitled";
    const text = it.text || it.content || "";
    const emb = it.emb || it.vec || it.embedding || null; // دعم vec/emb/embedding
    const source = it.source || it.file || title;
    return { id, source, title, text, emb };
  })
  .filter((it) => Array.isArray(it.emb) && it.emb.length && it.text);

// إعدادات خدمة الـ Embeddings
const OLLAMA_EMBED =
  process.env.OLLAMA_EMBED || "http://172.17.0.1:11434/api/embeddings";
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
  const r = await axios.post(
    OLLAMA_EMBED,
    {
      model: EMBED_MODEL,
      prompt: normalizeDigits(q),
    },
    { timeout: 30_000 }
  );
  return r.data?.embedding || r.data?.data?.[0]?.embedding || null;
}

// cosine محمية ضد الحالات الشاذة وطول المتجهات المختلف
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length)
    return -1;
  const n = Math.min(a.length, b.length);
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i],
      bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

async function retrieve(query, k = 3) {
  if (!INDEX.length) return [];
  const q = await embed(query);
  if (!Array.isArray(q) || !q.length) return [];
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
