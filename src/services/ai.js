const axios = require("axios");

const SITE_URL = process.env.SITE_URL || "https://www.ichancy.com/";
const AI_MODEL = process.env.AI_MODEL || "qwen2.5:7b-instruct-q4_K_M";
const OLLAMA_BASE =
  process.env.OLLAMA_BASE_URL ||
  (process.env.OLLAMA_URL || "").replace(/\/api\/.*$/, "") ||
  "http://ollama:11434";
const CHAT_URL = `${OLLAMA_BASE.replace(/\/$/, "")}/api/chat`;

function toShami(s = "") {
  // تلميع خفيف للشامي
  return s
    .replace(/يرجى|من فضلك|الرجاء/g, "لو سمحت")
    .replace(/سوف /g, "رح ")
    .replace(/القيمة/g, "المبلغ")
    .replace(/\s+/g, " ")
    .trim();
}
function clampTwoLines(s, max = 170) {
  let t = s.replace(/[*_`>~]/g, "").trim();
  if (t.length > max) t = t.slice(0, max - 1) + "…";
  return t.split(/\n+/).slice(0, 2).join("\n");
}

function buildSystemPrompt({ context = "" } = {}) {
  return [
    "أنت مساعد واتساب لخدمة شحن/سحب رصيد على موقع ايشانسي.",
    "اكتب باللهجة الشامية اليومية (تمام، شو، قديش، دغري).",
    "رد مختصر جدًا: سطر أو سطرين فقط. استخدم إيموجي خفيفة (👍✅⏳💳) إذا لزم.",
    `لا تعطي روابط غير ${SITE_URL} ولا تختلق معلومات.`,
    "لو نقصت معلومة، اسأل *سؤال واحد محدد* فقط وما تكرر السؤال السابق.",
    "للشحن: (اللعبة/المنصّة، المبلغ، الـID، طريقة الدفع). للسحب: (المبلغ، طريقة الاستلام، حساب/معرّف الاستلام).",
    context ? `معلومات من قاعدة المعرفة:\n${context}` : "",
    "أمثلة:",
    `المستخدم: بدي الرابط\nالمساعد: رابطنا: ${SITE_URL} ✅`,
    "المستخدم: بدي اشحن 20000 ل MLBB\nالمساعد: تمام! ابعت الـID وطريقة الدفع (سيريتيل كاش/USDT/بيمو) 👍",
  ]
    .filter(Boolean)
    .join("\n");
}

async function askAI(userText, { history = [], context = "" } = {}) {
  const messages = [
    { role: "system", content: buildSystemPrompt({ context }) },
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
          // أسرع + طائع
          num_predict: 64, // قلّل الطول لسرعة أعلى
          temperature: Number(process.env.AI_TEMPERATURE ?? 0.2),
          top_p: 0.9,
          top_k: 40,
          repeat_penalty: 1.15,
          num_ctx: 2048,
          // نقاط توقف لتقصير الرد
          stop: ["\n\nالمستخدم:", "\n\nUser:", "\n\nassistant:"],
        },
      },
      { timeout: 90000 } // 90 ثانية لتفادي أول تحميل بطيء
    );

    const raw =
      (r.data?.message?.content || "").trim() ||
      "تمام—اكتب طلبك باختصار (شحن/سحب + المبلغ + المعرف) 👍";
    return clampTwoLines(toShami(raw));
  } catch (err) {
    console.error("AI error:", err?.response?.data || err.message);
    return "تعطّل مؤقت… اكتب طلبك سطر واحد (شحن/سحب + المبلغ + الـID) وبمشيه 👍";
  }
}

module.exports = { askAI };
