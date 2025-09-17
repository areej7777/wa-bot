// src/services/topup_llm.js
const axios = require("axios");

// تحويل أرقام عربية -> لاتينية
function normalizeDigits(s = "") {
  const map = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
  };
  return (s || "").replace(/[٠-٩]/g, (d) => map[d]);
}

// تشذيب JSON من ردود LLM لو أضاف نص قبل/بعد
function extractJSON(txt = "") {
  txt = (txt || "").trim();
  try {
    return JSON.parse(txt);
  } catch {}
  const i = txt.indexOf("{");
  const j = txt.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try {
      return JSON.parse(txt.slice(i, j + 1));
    } catch {}
  }
  return null;
}

// توحيد أسماء الطرق
function canonMethod(s = "") {
  const t = normalizeDigits(s).toLowerCase();
  if (/(syriatel|سيريتيل|سيري|كاش)/.test(t)) return "سيريتيل كاش";
  if (/(usdt|تيثر|تتر)/.test(t)) return "USDT";
  if (/(bemo|بيمو)/.test(t)) return "بيمو";
  if (/(payeer|بايير)/.test(t)) return "بايير";
  if (/(هرم|الهرم)/.test(t)) return "هرم";
  return null;
}
function validTxid(s = "") {
  return /[\w\-]{4,}/.test((s || "").trim());
}
function parseAmount(s = "") {
  const n = parseInt(normalizeDigits(s).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// API call: يطلب من LLM خطة/خطوة تالية ضمن JSON فقط
async function askTopupPlanner({
  userText,
  state,
  minTopup,
  ollamaUrl,
  model,
}) {
  const sys = `أنت منظّم محادثة "تعبئة رصيد".
- اللغة: عربي شامي فقط، جمل قصيرة (≤ سطرين).
- اجمع الحقول تدريجيًا: method, txid, amount.
- method يجب أن تكون واحدة حرفيًا من: ["سيريتيل كاش","USDT","بيمو","بايير","هرم"].
- txid: نص (≥4) أرقام/حروف ويسمح بـ (-,_).
- amount: عدد صحيح ≥ ${minTopup}.
- أعد فقط JSON بدون أي نص خارجه بالصيغة:
{
 "intent":"topup",
 "status":"incomplete|ready",
 "need":"method|txid|amount|none",
 "fields":{"method":"","txid":"","amount":0},
 "reply":"رد عربي شامي مختصر للعميل"
}`;
  const messages = [
    { role: "system", content: sys },
    {
      role: "user",
      content: JSON.stringify({
        hint_state: state, // الحالة الحالية (قد تكون فارغة)
        user: userText,
      }),
    },
  ];

  const r = await axios.post(
    ollamaUrl || "http://ollama:11434/api/chat",
    {
      model: model || process.env.AI_MODEL || "qwen2.5:7b-instruct-q4_K_M",
      messages,
      stream: false,
      options: { num_predict: 120, temperature: 0.2, keep_alive: "24h" },
    },
    { timeout: 15000 }
  );
  return extractJSON(r.data?.message?.content || "");
}

// واجهة عالية المستوى: ترجع خطة مفلترة وصالحة
async function planTopupLLM({
  userText,
  state = {},
  minTopup = 10000,
  ollamaUrl,
  model,
}) {
  let plan =
    (await askTopupPlanner({ userText, state, minTopup, ollamaUrl, model })) ||
    {};
  plan.intent = "topup";

  // توحيد/تحقق على السيرفر (حماية)
  plan.fields = plan.fields || {};
  if (plan.fields.method) plan.fields.method = canonMethod(plan.fields.method);
  if (plan.fields.amount != null && typeof plan.fields.amount !== "number")
    plan.fields.amount = parseAmount(String(plan.fields.amount));

  // تكملة الحقول من state إذا ناقصة
  const merged = {
    method: plan.fields.method ?? state?.data?.method ?? null,
    txid: plan.fields.txid ?? state?.data?.txid ?? null,
    amount: plan.fields.amount ?? state?.data?.amount ?? null,
  };

  // تحقق نهائي
  let need = "none";
  if (!merged.method) need = "method";
  else if (!validTxid(merged.txid || "")) need = "txid";
  else if (!(merged.amount >= minTopup)) need = "amount";

  const ready = need === "none";

  // رسائل افتراضية إذا ردّ الـLLM ما كان مناسب
  let reply = (plan.reply || "").toString().trim();
  if (!reply) {
    if (need === "method")
      reply = "اختر طريقة الدفع: سيريتيل كاش / USDT / بيمو / بايير / هرم 👍";
    else if (need === "txid") reply = "ابعت رقم العملية/الإيصال متل ما هو 🔢";
    else if (need === "amount")
      reply = `قديش المبلغ؟ (الحد الأدنى ${minTopup} ل.س)`;
    else reply = "تمام! سجلت الطلب ✅";
  }

  return {
    status: ready ? "ready" : "incomplete",
    need,
    fields: merged,
    reply,
  };
}

module.exports = { planTopupLLM };
