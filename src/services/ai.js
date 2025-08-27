// src/services/ai.js
const axios = require("axios");

const SITE_URL = process.env.SITE_URL || "https://www.ichancy.com/";

const AI_MODEL = process.env.AI_MODEL || "qwen2.5:7b-instruct";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://172.17.0.1:11434/api/chat";

function buildSystemPrompt({ dialect = "syrian", context = "" } = {}) {
  return [
    "ىأنتَ مساعد واتساب لشركة شحن وسحب رصيد على موقع ايشانسي.",
    // EDIT_HERE: style (keep it short to stay fast)
    "الأسلوب: لهجة سورية مهذّبة، مختصرة وواضحة (حتى سطرين).",
    "القواعد:",
    `1) لا تختلق معلومات/روابط. للرابط أعطِ هذا فقط: ${SITE_URL}`,
    "2) لشحن/سحب اسأل عن: المبلغ،  معرّف الحساب، وطريقة الدفع/الاستلام.",
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
    { role: "user", content: "بدي اشحن 100 سيريتيل كاش " },
    {
      role: "assistant",
      content: "تمام—أبعت المعرّف/ID ورقم الموبايل وطريقة الدفع، وبباشر الطلب.",
    },

    ...history,
    { role: "user", content: userText },
  ];

  try {
    const r = await axios.post(
      OLLAMA_URL,
      {
        model: AI_MODEL,
        messages,
        stream: false,
        options: {
          // EDIT_HERE: response length / speed tradeoff
          num_predict: 120, // shorter & faster
          temperature: 0.2, // more obedient
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
      "تمام—خبرني تفاصيل طلبك (شحن/سحب + المبلغ + المعرّف)."
    );
  } catch (err) {
    console.error("AI error:", err?.response?.data || err.message);
    return "صار خلل بسيط. اكتب طلبك باختصار (شحن/سحب + المبلغ + المعرّف).";
  }
}

module.exports = { askAI, buildSystemPrompt };
