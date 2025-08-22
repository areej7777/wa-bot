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

// الموقع (فضّلي ضبطه من Environment)
const SITE_URL = process.env.SITE_URL || "https://www.ichancy.com/";

// نيّات سريعة
function routeIntent(txt) {
  const t = (txt || "").normalize("NFKC").toLowerCase();
  if (/(رابط|لينك|website|site|موقع)/i.test(t)) return "link";
  if (/(شحن|اشحن|رصيد|شدات|gems|top ?up)/i.test(t)) return "topup";
  if (/(سحب|اسحب|withdraw)/i.test(t)) return "withdraw";
  if (/(سعر|اسعار|باقات|العروض)/i.test(t)) return "pricing";
  return null;
}
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

// معالجة رسالة واحدة
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
  await sendWhatsAppText(
    from,
    "حدّدلي اللعبة/المنصّة أو المبلغ مشان جاوبك بدقّة 👍"
  );
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
