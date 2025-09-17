// src/index.js
require("dotenv").config();
const express = require("express");
const { askAI } = require("./services/ai");
const { sendWhatsAppText } = require("./services/whatsapp");
const { makeContext } = require("./services/rag");
const axios = require("axios");
const {
  detectIntent,
  extractAmount,
  extractGame,
  extractMethod,
  extractAccount,
} = require("./services/nlu");
const { createAccount } = require("./services/auth");
const {
  detectIntent,
  extractAmount,
  extractMethod,
  extractAccount,
} = require("./services/nlu");

// جلسات قصيرة: منخزّن حالة إنشاء الحساب فقط مؤقتًا
const SESS = new Map(); // phone -> { flow: 'signup', step: 'username'|'password', data: {username} }

const DIRECT_ANSWER = 0.85;
const CONTEXT_RANGE = 0.65;

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

function cleanUsername(s) {
  const u = (s || "").trim().match(/@?([a-zA-Z0-9._-]{3,20})/);
  return u ? u[1] : null;
}
function cleanPassword(s) {
  const p = (s || "").trim();
  // الحد الأدنى، بدون مسافات
  if (p.length >= 6 && !/\s/.test(p)) return p;
  return null;
}
function wipeSensitive(state) {
  if (state?.data) state.data.password = undefined;
}

async function handleMessage(from, text) {
  const hist = convo.get(from) || [];
  const intent = detectIntent(text);
  const state = SESS.get(from) || {};

  if (intent === "signup" || state.flow === "signup") {
    if (!state.flow) {
      SESS.set(from, { flow: "signup", step: "username", data: {} });
      console.log(`[signup] start from=${from}`);
      await sendWhatsAppText(
        from,
        "تمام! اختر اسم مستخدم (3–20 حرف/رقم، مسموح . _ -) 👍"
      );
      return;
    }
    if (state.step === "username") {
      const u = cleanUsername(text);
      if (!u) {
        await sendWhatsAppText(
          from,
          "ما ظبط. ابعت اسم مستخدم بدون مسافات، مثل: ichancy_2025"
        );
        return;
      }
      state.data.username = u;
      state.step = "password";
      SESS.set(from, state);
      console.log(`[signup] username=${u}`);
      await sendWhatsAppText(
        from,
        "حلو! هلا ابعت كلمة سر (6+ أحرف، بدون مسافات) 🔒"
      );
      return;
    }
    if (state.step === "password") {
      const p = cleanPassword(text);
      if (!p) {
        await sendWhatsAppText(
          from,
          "الكلمة قصيرة أو فيها مسافة. جرّب كلمة سر أطول بدون مسافات 🔒"
        );
        return;
      }
      state.data.password = p;
      try {
        const result = await createAccount({
          phone: from,
          username: state.data.username,
          password: p,
        }); // موك – نجاح شكلي
        SESS.delete(from);
        console.log(
          `[signup] done user=${state.data.username} ok=${!!result?.ok}`
        );
        await sendWhatsAppText(
          from,
          `تم! أنشأنا لك الحساب باسم ${state.data.username} ✅`
        );
      } catch (e) {
        SESS.delete(from);
        console.error("signup error:", e.message);
        await sendWhatsAppText(
          from,
          "صار خلل بسيط بإنشاء الحساب. جرّب بعد لحظات 🙏"
        );
      }
      return;
    }
  }

  // ===== نهاية فلو إنشاء حساب =====

  // … من هون نزّل باقي منطقك العادي (ردود فورية + RAG + LLM) …
  // مثال: ردود فورية شائعة
  const t = (text || "").toLowerCase();
  if (/(رابط|لينك|website|site|موقع)/.test(t)) {
    await sendWhatsAppText(from, `رابطنا: ${SITE_URL} ✅`);
    return;
  }
  if (/(اقل|أدنى|ادنى).{0,8}(شحن)/.test(t)) {
    await sendWhatsAppText(from, "أقل قيمة للشحن: 10000 ل.س ✅");
    return;
  }
  if (/(اقل|أدنى|ادنى).{0,8}(سحب)/.test(t)) {
    await sendWhatsAppText(from, "أقل قيمة للسحب: 500000 ل.س ✅");
    return;
  }

  // RAG → LLM (حسب ما مركّبه عندك)
  try {
    const { text: ctx, score } = await makeContext(text, { k: 1 });
    if (score >= 0.82 && ctx) {
      await sendWhatsAppText(from, ctx.split("\n")[0].trim());
      return;
    }
  } catch {}

  // LLM (مختصر وسريع) – نفس askAI اللي عندك
  const aiReply = await askAI(text, { history: hist, dialect: "shami" });
  await sendWhatsAppText(from, aiReply);

  convo.set(
    from,
    [
      ...hist,
      { role: "user", content: text },
      { role: "assistant", content: aiReply },
    ].slice(-8)
  );
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
        options: { num_predict: 4, keep_alive: "24h" },
      },
      { timeout: 12000 }
    );
    console.log("🔥 LLM warmed");
  } catch (e) {
    console.log("warmup skipped:", e.message);
  }
}
warmup();
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Bot listening on ${PORT}`));
