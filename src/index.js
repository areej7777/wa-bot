// src/index.js
require("dotenv").config();
const express = require("express");
const { askAI } = require("./services/ai");
const { sendWhatsAppText } = require("./services/whatsapp");
const { makeContext } = require("./services/rag");
const DIRECT_ANSWER = 0.85; // رد مباشر من KB
const CONTEXT_RANGE = 0.65; // تمرير سياق للـLLM

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

// EDIT_HERE: الموقع (يفضّل ضبطه كـ SITE_URL في Env بدلاً من تعديل الكود)
const SITE_URL = process.env.SITE_URL || "https://www.ichancy.com/";

// EDIT_HERE: كلمات النوايا — زيدي/عدّلي كلماتك
function routeIntent(txt) {
  const t = (txt || "").normalize("NFKC").toLowerCase();
  if (/(رابط|لينك|website|site|موقع)/i.test(t)) return "link";
  if (/(شحن|اشحن|رصيد|شدات|gems|top ?up)/i.test(t)) return "topup";
  if (/(سحب|اسحب|withdraw)/i.test(t)) return "withdraw";
  if (/(سعر|اسعار|باقات|العروض)/i.test(t)) return "pricing";
  return null;
}

// EDIT_HERE: استخراج رقم/مبلغ بسيط
function extractAmount(txt) {
  const m = (txt || "").match(/(\d{1,7})/); // up to 7 digits
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

// وحدة معالجة الرسالة
async function handleMessage(from, text) {
  const hist = convo.get(from) || [];

  // 1) نيّات فورية
  const intent = routeIntent(text);
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
      // EDIT_HERE: صيغة الأسئلة
      await sendWhatsAppText(
        from,
        "قدّيش المبلغ/الكميّة؟ واذكر اللعبة/المنصّة ومعرّف الحساب."
      );
      return;
    }
    await sendWhatsAppText(
      from,
      `تمام! سجّلت ${amount}. خبرني اللعبة/المنصّة ومعرّف الحساب وطريقة الدفع.`
    );
    return;
  }
  if (intent === "withdraw") {
    await sendWhatsAppText(
      from,
      "للسحب: ابعت قيمة السحب، المنصّة، وطريقة الاستلام (محفظة/تحويل...)."
    );
    return;
  }
  if (intent === "pricing") {
    await sendWhatsAppText(
      from,
      "الأسعار بتختلف حسب اللعبة والطريقة. اذكر اللعبة/الباقة المطلوبة وبعطيك السعر."
    );
    return;
  }

  // 2) باقي الحالات إلى LLM
  const reply = await askAI(text, {
    history: hist,
    dialect: "syrian",
    context: "",
  });
  await sendWhatsAppText(from, reply);

  const updated = [
    ...hist,
    { role: "user", content: text },
    { role: "assistant", content: reply },
  ].slice(-8);
  convo.set(from, updated);
}
const { text: ctx, score, hits } = await makeContext(text, { k: 3 });
console.log("RAG score:", score, "hit:", hits[0]?.id);

// 1) تطابق عالي → رد مباشر من أول مقطع (مختصر)
if (score >= DIRECT_ANSWER && hits[0]) {
  const firstLine = hits[0].text.split("\n")[0].trim();
  await sendWhatsAppText(from, firstLine);
  return;
}

// 2) تطابق متوسط → مرّر السياق للـLLM
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

// 3) تطابق ضعيف → سؤال توضيحي بدل التخمين
await sendWhatsAppText(
  from,
  "حدّدلي اللعبة/المنصّة أو المبلغ مشان جاوبك بدقّة 👍"
);
return;
// استقبال (POST) — نُعيد 200 فورًا، ونُكمل بالخلفية
app.post("/webhook", (req, res) => {
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];

    res.status(200).json({ status: "ok" }); // مهم حتى ما يعيد واتساب المحاولة

    if (!msg || msg.type !== "text") return;

    // لا تعالج نفس الرسالة مرتين
    if (seen.has(msg.id)) return;
    remember(msg.id);

    setImmediate(() =>
      handleMessage(msg.from, msg.text?.body || "").catch((e) =>
        console.error("Handle error:", e?.response?.data || e.message)
      )
    );
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Bot listening on ${PORT}`));
