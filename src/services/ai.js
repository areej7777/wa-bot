// services/ai.js
const axios = require("axios");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://172.17.0.1:11434/api/chat";
const AI_MODEL = process.env.AI_MODEL || "qwen2.5:7b-instruct";

function buildSystemPrompt({ dialect = "syrian", context = "" } = {}) {
  return [
    "أنتَ مساعد واتساب لشركة شحن وسحب رصيد ألعاب.",
    "الأسلوب: لهجة سورية مهذّبة، قصيرة وواضحة (سطرين–أربعة كحدّ أقصى).",
    "القواعد:",
    "1) لا تختلق معلومات أو روابط. إن لم تملك المعلومة قل: «ما عندي تفاصيل دقيقة، بقدر اساعدك بخطوات عامة» واسأل سؤال توضيحي.",
    "2) عند طلب الرابط أعطِ دوميننا الثابت فقط.",
    "3) عند طلب شحن/سحب استخدم أسئلة ملء خانات: (المبلغ،المنصّة، رقم الحساب/المعرّف).",
    "4) لا تغيّر اسم العميل ولا تخترع أسماء أشخاص.",
    "5) التزم بموضوع الخدمة فقط، واعتذر بلطف عن أي أسئلة خارج النطاق.",
    "6) لا تختلق روابط/أكواد/أسماء/أسعار. ممنوع إعطاء أي كود تحويل أو رقم عملية من عندك.",

    context ? `معلومات سياقيّة:\n${context}` : "",
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
    // أمثلة صغيرة تُثبّت السلوك
    { role: "user", content: "بدي الرابط" },
    {
      role: "assistant",
      content: `رابط موقعنا: ${
        process.env.SITE_URL || "https://www.ichancy.com/"
      }`,
    },

    { role: "user", content: "بدي اسحب 25000000 بيمو" },
    { role: "assistant", content: " بعتلي رقم حسابك البيمو لحولك ياهن فورا" },

    ...history,
    { role: "user", content: userText },
  ];

  try {
    const r = await axios.post(
      OLLAMA_URL,
      {
        model: AI_MODEL,
        messages,
        stream: false, // مهم: رد واحد نظيف
        options: {
          temperature: 0.15, // أقل عشوائية
          top_p: 0.9,
          top_k: 40,
          repeat_penalty: 1.1,
          num_ctx: 4096,
        },
      },
      { timeout: 60_000 }
    );

    const content = r.data?.message?.content?.trim();
    return content || "اهلا بالملك الاكابر، كيف فيني ساعدك؟";
  } catch (err) {
    console.error("AI error:", err?.response?.data || err.message);
    return "ممكن تشرحلي اكتر شو طلبك";
  }
}

module.exports = { askAI, buildSystemPrompt };
