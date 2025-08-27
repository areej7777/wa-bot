// scripts/index_kb.js
// يحوّل KB إلى فهرس Embeddings بسيط
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// مسارات الملفات
const KB_PATH = path.join(__dirname, "../data/kb.js");
const OUT_PATH = path.join(__dirname, "../data/index.json");

// إعدادات Ollama Embeddings
const OLLAMA_EMBED =
  process.env.OLLAMA_EMBED || "http://127.0.0.1:11434/api/embeddings";
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";

// تطبيع الأرقام العربية -> لاتينية (يحسّن التطابق)
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

// توسيع الاستعلام/النص بالمرادفات (يساعد الفهرسة)
// ملاحظة: هذه فقط للفهرسة (نضيف المرادفات إلى النص المفهرس).
const ALIASES = {
  payeer: ["payeer", "dollar", "عملات رقمية", "دولار", "دولار الكتروني"],
  USDT: ["usdt", "يو اس دي تي", "عملات رقمية", "دولار", "دولار الكتروني"],
  "syriatel cash": ["سيريتيل", "سيري", "syriatel", "كاش"],
  bemo: ["بيمو", "bemo"],
  "top up": ["شحن", "رصيد", "ايداع"],
  withdraw: ["سحب", "تحويل ", "withdraw"],
};

function enrichText(item) {
  const base = `${item.title}\n${item.content}\nTags: ${
    item.tags?.join(", ") || ""
  }`;
  const t = base.toLowerCase();
  const extra = [];
  for (const [canon, list] of Object.entries(ALIASES)) {
    if (list.some((w) => t.includes(w))) extra.push(canon, ...list);
  }
  return extra.length ? `${base}\nمرادفات: ${extra.join(", ")}` : base;
}

async function embed(text) {
  const r = await axios.post(OLLAMA_EMBED, {
    model: EMBED_MODEL,
    prompt: text,
  });
  return r.data?.embedding;
}

(async () => {
  // حمّل الـKB
  const KB = require(KB_PATH); // CommonJS
  if (!Array.isArray(KB) || KB.length === 0) {
    console.error("KB فارغة. راجعي data/kb.js");
    process.exit(1);
  }

  const items = [];
  for (const it of KB) {
    const txt = normalizeDigits(enrichText(it));
    const emb = await embed(txt);
    items.push({
      id: it.id,
      title: it.title,
      text: it.content,
      tags: it.tags || [],
      emb,
    });
    console.log("Indexed:", it.id);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(items));
  console.log("✅ Done →", OUT_PATH, "chunks:", items.length);
})();
