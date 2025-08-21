// src/index.js
require("dotenv").config();
const express = require("express");
const { askAI } = require("./services/ai");
const { sendWhatsAppText } = require("./services/whatsapp");
// RAG مؤقتًا غير مفعّل
// const { makeContext } = require("./services/rag-ollama");

const app = express();
app.use(express.json());

// ذاكرة قصيرة لكل رقم
const convo = new Map();

// التحقق من الويبهوك (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// استقبال الرسائل (POST)
app.post("/webhook", async (req, res) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];

    if (msg?.type === "text") {
      const from = msg.from; // رقم العميل (E.164)
      const text = (msg.text?.body || "").trim();

      const history = convo.get(from) || [];

      // ❌ RAG معطّل مؤقتًا
      // const ctx = await makeContext(text);
      // const context = ctx.text;
      const context = ""; // سياق فارغ

      const aiReply = await askAI(text, {
        history,
        dialect: "syrian",
        context,
      });

      await sendWhatsAppText(from, aiReply);

      const updated = [
        ...history,
        { role: "user", content: text },
        { role: "assistant", content: aiReply },
      ].slice(-8);
      convo.set(from, updated);
    }
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
  }
  // مهم: أعِد 200 دائمًا حتى لا تعيد Meta المحاولة
  res.sendStatus(200);
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Bot listening on ${PORT}`);
});
