// src/services/ai.js
require("dotenv").config();
const axios = require("axios");

const MODEL = process.env.AI_MODEL || "llama3.1:8b";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat";
const TEMPERATURE = Number(process.env.AI_TEMPERATURE || 0.5);
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 350);

function buildSystemPrompt({ dialect = "syrian", allowArabizi = true } = {}) {
  const lines = [
    "انت مساعد واتساب للشركة.",
    "رد باللهجة الشامية المهذبة أو بالعربية المبسطة حسب أسلوب المستخدم.",
    "خليك مختصر (سطرين–4).",
    "جاوب ضمن نطاق الخدمة؛ وإذا السؤال مو واضح اسأل سؤال توضيحي واحد.",
    "تجنّب الألفاظ السوقية والوعود غير الدقيقة.",
  ];
  if (dialect === "syrian")
    lines.push(
      "مفردات مسموحة: شو، ليش، هيك، لسا، مو، تمام، طيب، أكيد، هلق، كتير."
    );
  if (allowArabizi) lines.push("إذا المستخدم كتب بعربيزي، رد بعربيزي مهذّب.");
  return lines.join(" ");
}
const sliceForWhatsApp = (s) =>
  String(s || "")
    .trim()
    .slice(0, 3500) || "تمام، كيف فيني ساعدك؟";

async function askAI(
  userText,
  { history = [], dialect = "syrian", context = "" } = {}
) {
  const messages = [
    { role: "system", content: buildSystemPrompt({ dialect }) },
    context
      ? {
          role: "system",
          content: `اعتمد على المعلومات التالية إن كانت مفيدة:\n${context}`,
        }
      : null,
    { role: "user", content: "شو الباقات المتوفرة؟" },
    {
      role: "assistant",
      content: "عنا 3 باقات: أساسية، قياسية، ومميزة. فيني وضّحلك الفرق بسرعة.",
    },
    ...history,
    { role: "user", content: userText },
  ].filter(Boolean);

  try {
    const r = await axios.post(
      OLLAMA_URL,
      {
        model: MODEL,
        options: { temperature: TEMPERATURE, num_predict: MAX_TOKENS },
        messages,
      },
      { timeout: 30000 }
    );
    const out = r.data?.message?.content || r.data?.content || "";
    return sliceForWhatsApp(out);
  } catch (e) {
    console.error("AI error:", e?.response?.data || e.message);
    return "آسف، صار تأخير بسيط. فيني أعيد المحاولة أو خوّليك لزميلي البشري؟";
  }
}

module.exports = { askAI, buildSystemPrompt };
