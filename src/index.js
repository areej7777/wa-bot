// src/index.js
require("dotenv").config();
const express = require("express");
const { askAI } = require("./services/ai");
const { sendWhatsAppText } = require("./services/whatsapp");
// RAG مؤقتًا غير مفعّل
// const { makeContext } = require("./services/rag-ollama");

const app = express();
app.use(express.json());

// ذاكرة قصيرة لكل رقم
const convo = new Map();

// التحقق من الويبهوك (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});
const SITE_URL = process.env.SITE_URL || "https://www.ichancy.com/";

function routeIntent(txt) {
  const t = txt.normalize("NFKC").toLowerCase();
  if (/(رابط|لينك|website|site|موقع)/i.test(t)) return "link";
  if (/(شحن|اشحن|رصيد|مبلغ| ?up)/i.test(t)) return "topup";
  if (/(سحب|اسحب|withdraw)/i.test(t)) return "withdraw";
  if (/(usdt|بيمو|شام كاش|سيريتيل كاش)/i.test(t)) return "paymentmethod";
  return null;
}

function extractAmount(txt) {
  // حوّل الأرقام العربية ٠١٢٣٤٥٦٧٨٩ إلى 0123456789
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
  const norm = txt.replace(/[٠-٩]/g, (d) => map[d]);
  const m = norm.match(/(\d{1,9})/);
  return m ? parseInt(m[1], 10) : null;
}
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (msg?.type !== "text") return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body || "";
    const hist = convo.get(from) || [];

    // 1) روتر نوايا سريع
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
      return res.sendStatus(200);
    }

    if (intent === "topup") {
      const amount = extractAmount(text);
      if (!amount) {
        await sendWhatsAppText(
          from,
          "قدّيش الكميّة/المبلغ اللي بدك تشحنه؟ واذكر اللعبة/المنصّة ومعرّف الحساب."
        );
        return res.sendStatus(200);
      }
      await sendWhatsAppText(
        from,
        `تمام! سجّلت ${amount}. خبرني اللعبة/المنصّة ومعرّف الحساب وطريقة الدفع.`
      );
      return res.sendStatus(200);
    }

    if (intent === "withdraw") {
      await sendWhatsAppText(
        from,
        "تمام للسحب—ابعث قيمة السحب، والطريقة (محفظة/تحويل...)."
      );
      return res.sendStatus(200);
    }

    if (intent === "paymentmethod") {
      await sendWhatsAppText(
        from,
        "طرق الدفع المتوفرة حاليا هيي : سيريتيل كاش ،بيمو ، شام كاش ، USDT،بايير علما انو اقل مبلغ للشحن هو 10,000"
      );
      return res.sendStatus(200);
    }

    // 2) الباقي إلى LLM مع ذاكرة قصيرة
    const aiReply = await askAI(text, {
      history: hist,
      dialect: "syrian",
      context: "",
    });
    await sendWhatsAppText(from, aiReply);

    const updated = [
      ...hist,
      { role: "user", content: text },
      { role: "assistant", content: aiReply },
    ].slice(-8);
    convo.set(from, updated);
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
  }
  res.status(200).json({ status: "ok" });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Bot listening on ${PORT}`);
});
