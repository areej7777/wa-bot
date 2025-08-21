// src/services/rag.js (اختياري)
require("dotenv").config();
const axios = require("axios");
const KB = require("../../data/kb");

async function embed(text) {
  const r = await axios.post(
    "https://api.openai.com/v1/embeddings",
    { model: "text-embedding-3-small", input: text },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
  );
  return r.data.data[0].embedding;
}

function cosine(a, b) {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return s / (Math.sqrt(na) * Math.sqrt(nb));
}

let INDEX = null;
async function buildIndex() {
  if (INDEX) return INDEX;
  INDEX = [];
  for (const doc of KB) {
    const emb = await embed(`${doc.title}\n${doc.content}`);
    INDEX.push({ ...doc, emb });
  }
  return INDEX;
}

async function retrieve(query, k = 4) {
  await buildIndex();
  const qEmb = await embed(query);
  const scored = INDEX.map(d => ({ ...d, score: cosine(qEmb, d.emb) }));
  return scored.sort((a,b) => b.score - a.score).slice(0, k);
}

async function makeContext(query, k = 4) {
  const top = await retrieve(query, k);
  const best = top[0]?.score || 0;
  return {
    text: top.map(t => `# ${t.title}\n${t.content}`).join("\n\n---\n\n"),
    score: best
  };
}

module.exports = { makeContext };
