// services/ai.js
const axios = require("axios");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://172.17.0.1:11434/api/chat";
const AI_MODEL = process.env.AI_MODEL || "llama3.1:8b";

function buildSystemPrompt({ dialect = "syrian", context = "" } = {}) {
  return [
    "أنت مساعد واتساب ترد باللهجة السورية القصيرة والمهذبة.",
    "اختصر الرد بـ 2–4 أسطر.",
    context ? `معلومات سياقية:\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function askAI(
  userText,
  { history = [], dialect = "syrian", context = "" } = {}
) {
  const system = buildSystemPrompt({ dialect, context });

  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userText },
  ];

  try {
    // مهم: stream=false عشان يرجّع رد واحد في message.content
    const r = await axios.post(
      OLLAMA_URL,
      {
        model: AI_MODEL,
        messages,
        stream: false,
        options: { temperature: 0.4 },
      },
      { timeout: 60000 }
    );

    const content = r.data?.message?.content?.trim();
    if (content) return content;

    console.warn("AI empty content:", r.data);
    return "تمام، كيف فيني ساعدك؟";
  } catch (err) {
    console.error("AI error:", err?.response?.data || err.message);
    return "صار خلل بسيط بالذكاء، جرّب تكتب طلبك بجملة واضحة.";
  }
}

module.exports = { askAI, buildSystemPrompt };
