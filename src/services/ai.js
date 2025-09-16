// src/services/ai.js
const axios = require("axios");

const SITE_URL = process.env.SITE_URL || "https://www.ichancy.com/";
const AI_MODEL = process.env.AI_MODEL || "qwen2.5:7b-instruct";

// شبكة Dokploy الداخلية
const OLLAMA_BASE =
  process.env.OLLAMA_BASE_URL ||
  (process.env.OLLAMA_URL || "").replace(/\/api\/.*$/, "") ||
  "http://ollama:11434";
const CHAT_URL = `${OLLAMA_BASE.replace(/\/$/, "")}/api/chat`;

// تلميع للهجة الشامية + تقصير
function toShami(s = "") {
  const repl = [
    [/يرجى/g, "لو سمحت"],
    [/من فضلك/g, "لو سمحت"],
    [/سوف /g, "رح "],
    [/قم ب/g, "اعمل "],
    [/الرجاء/g, "لو سمحت"],
    [/القيمة/g, "المبلغ"],
    [/نعم/g, "اي"],
    [/لا بأس/g, "ما في مشكلة"],
  ];
  let out = s;
  for (const [a, b] of repl) out = out.replace(a, b);
  return out.replace(/\s+/g, " ").trim();
}
function clampTwoLines(text, maxChars = 180) {
  let t = text.trim();
  if (t.length > maxChars) t = t.slice(0, maxChars - 1) + "…";
  t = t.replace(/[*_`>~]/g, "");
  return t.split(/\n+/).slice(0, 2).join("\n");
}

function buildSystemPrompt({ dialect = "shami", context = "" } = {}) {
  return [
    "أنت مساعد واتساب لخدمة شحن/سحب رصيد على موقع ايشانسي.",
    "اكتب باللهجة الشامية اليومية (كلمات مثل: تمام، شو، قديش، لحظة، دغري).",
    "الأسلوب: مختصر وواضح، سطر أو سطرين فقط، مع إيموجي خفيفة (👍✅⏳💳).",
    `لا تعطي روابط غير ${SITE_URL} ولا تختلق معلومات.`,
    "لو ناقص معلومة، اسأل *سؤال واحد محدد* فقط، وما تعيد نفس السؤال إذا انذكر قبل.",
    "لو الطلب واضح، جاوب دغري بدون لف ودوران.",
    "للشحن: (اللعبة/المنصّة، المبلغ، الـID، طريقة الدفع). للسحب: (المبلغ، طريقة الاستلام، حساب/معرّف الاستلام).",
    context ? `معلومات سياقية:\n${context}` : "",
    "أمثلة:",
    `المستخدم: بدي الرابط\nالمساعد: رابطنا: ${SITE_URL} ✅`,
    "المستخدم: بدي اشحن 20000 ل MLBB\nالمساعد: تمام! ابعت الـID وطريقة الدفع (سيريتيل كاش/USDT/بيمو) 👍",
    "المستخدم: بدي اسحب 700 ألف\nالمساعد: تمام! طريقة الاستلام شو بتحب؟ (بيمو/USDT/هرم) 😊",
  ]
    .filter(Boolean)
    .join("\n");
}

async function askAI(
  userText,
  { history = [], dialect = "shami", context = "" } = {}
) {
  const system = buildSystemPrompt({ dialect, context });

  const messages = [
    { role: "system", content: system },
    // few-shot قصيرة لتثبيت النبرة
    { role: "user", content: "بدي الرابط" },
    { role: "assistant", content: `رابطنا: ${SITE_URL} ✅` },
    { role: "user", content: "بدي اشحن 100 سيريتيل كاش" },
    {
      role: "assistant",
      content: "تمام—ابعت الـID ورح نجهّز الطلب. الدفع سيريتيل كاش 💳",
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
          num_predict: 90,
          temperature: Number(process.env.AI_TEMPERATURE ?? 0.25),
          top_p: 0.9,
          top_k: 40,
          repeat_penalty: 1.15,
          num_ctx: 2048,
        },
      },
      { timeout: 30000 }
    );

    const raw =
      (r.data?.message?.content || "").trim() ||
      "تمام—خبرني المبلغ والمعرّف وطريقة الدفع لكمّل لك بسرعة 👍";

    return clampTwoLines(toShami(raw));
  } catch (err) {
    console.error("AI error:", err?.response?.data || err.message);
    return "صار خلل بسيط. خبرني طلبك باختصار (شحن/سحب + المبلغ + المعرّف) وبمشيه 👍";
  }
}

module.exports = { askAI, buildSystemPrompt };
