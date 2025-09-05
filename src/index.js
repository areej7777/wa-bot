// src/index.js
require("dotenv").config();
const express = require("express");
const { askAI } = require("./services/ai");
const { sendWhatsAppText } = require("./services/whatsapp");
const { makeContext } = require("./services/rag");

// عتبات RAG
const DIRECT_ANSWER = 0.85; // ≥ → رد مباشر من KB
const CONTEXT_RANGE = 0.65; // [0.65..0.85) → مرّر سياق للـLLM

const app = express();
app.use(express.json({ limit: "1mb" }));

// صحّة
app.get("/", (_, res) => res.status(200).send("ok"));

// ذاكرة قصيرة + تفادي تكرار
const convo = new Map(); // phone -> [{role,content}...]
const seen = new Map(); // msg.id -> time
function remember(id) {
  const now = Date.now();
  seen.set(id, now);
  for (const [k, t] of seen) if (now - t > 15 * 60 * 1000) seen.delete(k);
}

// حالة محادثة خاصّة بتدفّق التسجيل
const flow = new Map(); // phone -> { name?: string, step?: "await_username"|"await_password" }

// التحقق من اسم اللاعب: أحرف لاتينية وأرقام فقط، طول 3–20، بدون مسافات
const USERNAME_RE = /^[A-Za-z0-9]{3,20}$/;
function sanitizeName(s) {
  return (s || "").trim().replace(/\s+/g, "");
}
function isValidUsername(s) {
  return USERNAME_RE.test(sanitizeName(s));
}
// الموقع (فضّلي ضبطه من Environment)
const SITE_URL = process.env.SITE_URL || "https://www.ichancy.com/";

// تطبيع الأرقام العربية -> لاتينية (يفيد الاستخراج والبحث)
function normalizeDigits(s) {
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
function routeIntent(txt) {
  const t = normalizeDigits((txt || "").normalize("NFKC").toLowerCase());
  if (/(رابط|لينك|website|site|موقع)/i.test(t)) return "link";
  if (/(شحن|اشحن|رصيد|top ?up)/i.test(t)) return "topup";
  if (/(سحب|اسحب|withdraw)/i.test(t)) return "withdraw";
  if (
    /(إنشاء|انشاء|تسجيل|سجل|اعمل|عمل|create|register|sign ?up)/i.test(t) &&
    /(حساب|account)/i.test(t) &&
    /(ايشانسي|ichancy)?/i.test(t)
  ) {
    return "signup";
  }
  return null;
}
function extractAmount(txt) {
  const m = normalizeDigits(txt).match(/(\d{1,7})/u); // يدعم ٠-٩ بعد التطبيع
  return m ? parseInt(m[1], 10) : null;
}

// التحقق (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// معالجة رسالة واحدة
async function handleMessage(from, text) {
  const hist = convo.get(from) || [];
  // 0) إذا الزبون جوّا تدفّق التسجيل حالياً، كمّل الخطوة المناسبة
  const f = flow.get(from);
  if (f?.step === "await_username") {
    if (!isValidUsername(text)) {
      await sendWhatsAppText(
        from,
        "اكتب اسم اللاعب المطلوب (أحرف لاتينية A-Z وأرقام فقط، 3–20 حرف، بدون مسافات)."
      );
      return;
    }
    f.name = sanitizeName(text);
    f.step = "await_password";
    flow.set(from, f);
    await sendWhatsAppText(
      from,
      "تمام! اكتب كلمة السر اللي بدك تعتمدها للحساب."
    );
    return;
  }
  if (f?.step === "await_password") {
    // ملاحظات أمان: لا نطبع/نلوّغ كلمة السر أبداً
    const password = (text || "").trim();
    if (!password) {
      await sendWhatsAppText(from, "اكتب كلمة سر صالحة.");
      return;
    }
    // هون بتعمل الإنشاء الحقيقي لو عندك API؛ حالياً منكتفي بتأكيد الاستلام
    const name = f.name;
    flow.delete(from); // خلّص التدفّق
    await sendWhatsAppText(
      from,
      `تمام—سجّلنا البيانات:\nالاسم: ${name}\nكلمة السر: تم استلامها.\nإذا بدك نكمّل إنشاء الحساب خبرني بـ "تم".`
    );
    return;
  }
  // 1) نيّات فورية
  const intent = routeIntent(text);
  if (intent === "signup") {
    // ابدأ التدفّق
    flow.set(from, { step: "await_username" });
    await sendWhatsAppText(
      from,
      "تمام—خلّينا ننشئ حسابك على ايشانسي.\nاكتب اسم اللاعب المطلوب (أحرف لاتينية A-Z وأرقام فقط، 3–20 حرف، بدون مسافات)."
    );
    return;
  }
  if (intent === "link") {
    await sendWhatsAppText(from, `رابط موقعنا: ${SITE_URL}`);
    convo.set(
      from,
      [
        ...hist,
        { role: "user", content: text },
        { role: "assistant", content: `رابط موقعنا: ${SITE_URL}` },
      ].slice(-8)
    );
    return;
  }
  if (intent === "topup") {
    const amount = extractAmount(text);
    if (!amount) {
      await sendWhatsAppText(from, "قدّيش المبلغ؟.");
      return;
    }
    await sendWhatsAppText(
      from,
      `تمام! سجّلت ${amount}. خبرني طريقة الدفع (سيريتيل/شام/USDT/بيمو/بايير) ورقم العملية.`
    );
    return;
  }
  if (intent === "withdraw") {
    await sendWhatsAppText(
      from,
      "للسحب: ابعت قيمة السحب،  وطريقة الاستلام (محفظة/تحويل...)."
    );
    return;
  }

  // 2) RAG — القرار حسب الدرجة (هنا كان الخطأ عندك؛ لازم يكون داخل دالة async)
  try {
    const { text: ctx, score, hits } = await makeContext(text, { k: 3 });
    console.log("RAG score:", score, "hit:", hits[0]?.id);
    // تطابق عالي → رد مباشر من الـKB
    if (score >= DIRECT_ANSWER && hits[0]) {
      const firstLine = hits[0].text.split("\n")[0].trim();
      await sendWhatsAppText(from, firstLine);
      return;
    }

    // تطابق متوسط → مرّر سياق للـLLM
    if (score >= CONTEXT_RANGE) {
      const aiReply = await askAI(text, {
        history: hist,
        dialect: "syrian",
        context: ctx,
      });
      await sendWhatsAppText(from, aiReply);
      convo.set(
        from,
        [
          ...hist,
          { role: "user", content: text },
          { role: "assistant", content: aiReply },
        ].slice(-8)
      );
      return;
    }
  } catch (e) {
    console.error("RAG error:", e?.response?.data || e.message);
    // نكمل للفولباك
  }

  // 3) تطابق ضعيف → سؤال توضيحي (أسرع وأدق من تخمين LLM)
  await sendWhatsAppText(from, "كيف بقدر ساعدك ياملك");
  return;
}

// استقبال (POST) — نُعيد 200 فورًا، ونُكمل بالخلفية
app.post("/webhook", (req, res) => {
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];

    // مهم: 200 فورًا حتى ما يعيد واتساب المحاولة
    res.status(200).json({ status: "ok" });

    if (!msg || msg.type !== "text") return;
    if (seen.has(msg.id)) return; // لا تعالج نفس الرسالة مرتين
    remember(msg.id);

    const from = msg.from;
    const text = msg.text?.body || "";

    setImmediate(() =>
      handleMessage(from, text).catch((e) =>
        console.error("Handle error:", e?.response?.data || e.message)
      )
    );
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Bot listening on ${PORT}`));
