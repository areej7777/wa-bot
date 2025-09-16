// src/index.js
require("dotenv").config();
const express = require("express");
const { askAI } = require("./services/ai");
const { sendWhatsAppText } = require("./services/whatsapp");
const { makeContext } = require("./services/rag");
const axios = require("axios");

const DIRECT_ANSWER = 0.85; // ≥ → رد مباشر من KB
const CONTEXT_RANGE = 0.65; // [0.65..0.85) → مرّر سياق للـLLM

const app = express();
app.use(express.json({ limit: "1mb" }));

// صحّة
app.get("/", (_, res) => res.status(200).send("ok"));

const convo = new Map();
const seen = new Map(); // msg.id -> time
function remember(id) {
  const now = Date.now();
  seen.set(id, now);
  for (const [k, t] of seen) if (now - t > 15 * 60 * 1000) seen.delete(k);
}

// الموقع (فضّلي ضبطه من Environment)
const SITE_URL = process.env.SITE_URL || "https://www.ichancy.com/";

// نيّات سريعة
function routeIntent(txt) {
  const t = (txt || "").normalize("NFKC").toLowerCase();
  if (/(رابط|لينك|website|site|موقع)/i.test(t)) return "link";
  if (/(شحن|اشحن|رصيد|شدات|gems|top ?up)/i.test(t)) return "topup";
  if (/(سحب|اسحب|withdraw)/i.test(t)) return "withdraw";
  if (/(سعر|اسعار|باقات|العروض)/i.test(t)) return "pricing";
  return null;
}
function extractAmount(txt) {
  const m = (txt || "").match(/(\d{1,7})/); // up to 7 digits
  return m ? parseInt(m[1], 10) : null;
}

// التحقق (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// معالجة رسالة واحدة
// داخل src/index.js
async function handleMessage(from, text) {
  const hist = convo.get(from) || [];

  try {
    // سياق من الـRAG بس (بدون عتبات/فروع)
    const { text: ctx } = await makeContext(text, { k: 3 });

    // خليه يجاوب/يسأل السؤال الناقص بلهجة شامية
    const aiReply = await askAI(text, {
      history: hist,
      dialect: "shami",
      context: ctx,
    });

    await sendWhatsAppText(from, aiReply);

    // ذاكرة قصيرة للحوار
    convo.set(
      from,
      [
        ...hist,
        { role: "user", content: text },
        { role: "assistant", content: aiReply },
      ].slice(-10)
    );
  } catch (e) {
    console.error("Handle error:", e?.response?.data || e.message);
    await sendWhatsAppText(
      from,
      "تعطّل بسيط… جرّب تكتب طلبك سطر واحد (شحن/سحب + المبلغ + المعرّف) 🙏"
    );
  }
}

// استقبال (POST) — نُعيد 200 فورًا، ونُكمل بالخلفية
app.post("/webhook", (req, res) => {
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];

    // مهم: 200 فورًا حتى ما يعيد واتساب المحاولة
    res.status(200).json({ status: "ok" });

    if (!msg || msg.type !== "text") return;
    if (seen.has(msg.id)) return; // لا تعالج نفس الرسالة مرتين
    remember(msg.id);

    const from = msg.from;
    const text = msg.text?.body || "";

    setImmediate(() =>
      handleMessage(from, text).catch((e) =>
        console.error("Handle error:", e?.response?.data || e.message)
      )
    );
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
  }
});

const PORT = Number(process.env.PORT || 3000);
async function warmup() {
  try {
    await axios.post(
      `${(process.env.OLLAMA_BASE_URL || "http://ollama:11434").replace(
        /\/$/,
        ""
      )}/api/generate`,
      {
        model: process.env.AI_MODEL || "qwen2.5:7b-instruct-q4_K_M",
        prompt: "hi",
        stream: false,
        options: { num_predict: 4 },
      },
      { timeout: 20000 }
    );
    console.log("🔥 LLM warmed");
  } catch (e) {
    console.log("warmup skipped:", e.message);
  }
}
warmup();
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Bot listening on ${PORT}`));
