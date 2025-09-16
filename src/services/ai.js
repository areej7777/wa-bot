// src/services/ai.js
const axios = require("axios");

const SITE_URL = process.env.SITE_URL || "https://www.ichancy.com/";
const AI_MODEL = process.env.AI_MODEL || "qwen2.5:7b-instruct";

// اجعلنا نقرأ من OLLAMA_BASE_URL أولاً، مع Backward-compat لـ OLLAMA_URL
const OLLAMA_BASE =
  process.env.OLLAMA_BASE_URL ||
  (process.env.OLLAMA_URL || "").replace(/\/api\/.*$/, "") ||
  "http://ollama:11434";
const CHAT_URL = `${OLLAMA_BASE.replace(/\/$/, "")}/api/chat`;

function buildSystemPrompt({ dialect = "syrian", context = "" } = {}) {
  return [
    "أنتَ مساعد واتساب لشركة شحن وسحب رصيد على موقع ايشانسي.",
    "الأسلوب: لهجة سورية مهذّبة، مختصرة وواضحة (حتى سطرين).",
    `1) لا تختلق معلومات/روابط. للرابط أعطِ هذا فقط: ${SITE_URL}`,
    "2) لشحن/سحب اسأل عن: المبلغ، معرّف الحساب، وطريقة الدفع/الاستلام.",
    "3) استخدم العربية/اللهجة السورية الشامية فقط.",
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
    { role: "user", content: "بدي الرابط" },
    { role: "assistant", content: `رابط موقعنا: ${SITE_URL}` },
    { role: "user", content: "بدي اشحن 100 سيريتيل كاش" },
    {
      role: "assistant",
      content: "تمام—أبعت المعرّف/ID ورقم الموبايل وطريقة الدفع، وبباشر الطلب.",
    },
    ...history,
    { role: "user", content: userText },
  ];

  try {
    const r = await axios.post(
      CHAT_URL,
      {
        model: AI_MODEL,
        messages,
        stream: false,
        options: {
          num_predict: 120,
          temperature: Number(process.env.AI_TEMPERATURE ?? 0.2),
          top_p: 0.9,
          top_k: 40,
          repeat_penalty: 1.1,
          num_ctx: 2048,
        },
      },
      { timeout: 30000 }
    );

    return (
      (r.data?.message?.content || "").trim() ||
      "تمام—اكتب طلبك باختصار (شحن/سحب + المبلغ + المعرّف)."
    );
  } catch (err) {
    console.error("AI error:", err?.response?.data || err.message);
    return "صار خلل بسيط. اكتب طلبك باختصار (شحن/سحب + المبلغ + المعرّف).";
  }
}

module.exports = { askAI, buildSystemPrompt };
