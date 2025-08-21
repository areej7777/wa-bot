// src/services/ai.js
require("dotenv").config();
const axios = require("axios");

const MODEL = process.env.AI_MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.AI_TEMPERATURE || 0.5);
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 350);

function buildSystemPrompt({ dialect = "syrian", allowArabizi = true } = {}) {
  const base = [
    "انت مساعد واتساب للشركة.",
    "رد باللهجة الشامية المهذبة أو بالعربية المبسطة حسب أسلوب المستخدم.",
    "خليك مختصر (سطرين–4).",
    "جاوب فقط ضمن نطاق الخدمة؛ وإذا السؤال مو واضح اسأل سؤال توضيحي واحد.",
    "تجنّب الألفاظ السوقية والوعود غير الدقيقة.",
  ];
  if (dialect === "syrian") base.push("مفردات مسموحة: شو، ليش، هيك، لسا، مو، تمام، طيب، أكيد، هلق، كتير.");
  if (allowArabizi) base.push("إذا المستخدم كتب بعربيزي، رد بعربيزي مهذّب.");
  return base.join(" ");
}

function sliceForWhatsApp(text) {
  const s = String(text || "").trim();
  return s.length <= 3500 ? s : s.slice(0, 3490) + "…"; // هامش أقل من 4096
}

async function askAI(userText, { history = [], dialect = "syrian", context = "" } = {}) {
  const headers = {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };

  const messages = [
    { role: "system", content: buildSystemPrompt({ dialect }) },
    context ? { role: "system", content: `اعتمد فقط على المعلومات التالية إن كانت مفيدة:\n${context}` } : null,
    // أمثلة قصيرة للأسلوب
    { role: "user", content: "شو الباقات المتوفرة؟" },
    { role: "assistant", content: "عنا 3 باقات: أساسية، قياسية، ومميزة. فيني وضّحلك الفرق بسرعة." },
    ...history,
    { role: "user", content: userText },
  ].filter(Boolean);

  const body = { model: MODEL, temperature: TEMPERATURE, max_tokens: MAX_TOKENS, messages };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await axios.post("https://api.openai.com/v1/chat/completions", body, { headers, timeout: 20000 });
      const out = r.data.choices?.[0]?.message?.content?.trim() || "";
      return sliceForWhatsApp(out || "تمام، كيف فيني ساعدك؟");
    } catch (e) {
      if (attempt === 2) {
        console.error("AI error:", e?.response?.data || e.message);
        return "آسف، صار تأخير بسيط. فيني أعيد المحاولة أو خوّليك لزميلي البشري؟";
      }
      await new Promise(res => setTimeout(res, 600 * attempt));
    }
  }
}

module.exports = { askAI };
