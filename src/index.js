// src/index.js
require("dotenv").config();
const express = require("express");
const { askAI } = require("./services/ai");
const { sendWhatsAppText } = require("./services/whatsapp");
const { makeContext } = require("./services/rag");
const axios = require("axios");

const DIRECT_ANSWER = 0.85;
const CONTEXT_RANGE = 0.65;

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", (_, res) => res.status(200).send("ok"));

const convo = new Map();
const seen = new Map();
function remember(id) {
  const now = Date.now();
  seen.set(id, now);
  for (const [k, t] of seen) if (now - t > 15 * 60 * 1000) seen.delete(k);
}

const flow = new Map();

const USERNAME_RE = /^[A-Za-z0-9]{3,20}$/;
function sanitizeName(s) {
  return (s || "").trim().replace(/\s+/g, "");
}
function isValidUsername(s) {
  return USERNAME_RE.test(sanitizeName(s));
}
// الموقع (فضّلي ضبطه من Environment)
const SITE_URL = process.env.SITE_URL || "https://www.ichancy.com/";

const TOPUP_WEBHOOK_URL = process.env.TOPUP_WEBHOOK_URL || "";
const TOPUP_WEBHOOK_SECRET = process.env.TOPUP_WEBHOOK_SECRET || "";
const MIN_TOPUP = Number(process.env.MIN_TOPUP || 10000);

const METHODS = {
  syriatel: {
    label: "سيريتيل كاش",
    synonyms: ["سيريتيل", "syriatel", "سيري", "سيريتيل كاش"],
  },
  sham: { label: "شام كاش", synonyms: ["شام", "شام كاش"] },
  bemo: { label: "بنك بيمو", synonyms: ["بيمو", "bemo", "بنك بيمو"] },
  usdt: { label: "USDT", synonyms: ["usdt", "يو اس دي تي", "تيذر"] },
  payeer: { label: "بايير", synonyms: ["payeer", "بايير"] },
};

const PAY_ACCOUNTS = {
  syriatel: process.env.SYRIATEL_CODE || "",
  sham: process.env.SHAM_CODE || "",
  bemo: process.env.BEMO_ACCOUNT || "",
  usdt: process.env.USDT_ADDRESS || "",
  payeer: process.env.PAYEER_ACCOUNT || "",
};

const topupFlow = new Map();

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

function normalizeMethod(text) {
  const t = (text || "").trim().toLowerCase();
  for (const key of Object.keys(METHODS)) {
    if (METHODS[key].synonyms.some((w) => t.includes(w.toLowerCase())))
      return key;
  }
  return null;
}

function listMethods() {
  return "اختر طريقة الدفع:\n- سيريتيل كاش\n- شام كاش\n- بنك بيمو\n- USDT\n- بايير";
}

function getAccountFor(method) {
  const acc = PAY_ACCOUNTS[method] || "";
  return acc.trim();
}

async function submitTopup(payload) {
  if (!TOPUP_WEBHOOK_URL) return { ok: false, reason: "NO_WEBHOOK" };
  try {
    const r = await axios.post(
      TOPUP_WEBHOOK_URL,
      { ...payload, secret: TOPUP_WEBHOOK_SECRET },
      { timeout: 10000 }
    );
    return { ok: true, status: r.status };
  } catch (e) {}
}

function routeIntent(txt) {
  const t = (txt || "").normalize("NFKC").toLowerCase();
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

const ACCOUNT_CHECK_URL = process.env.ACCOUNT_CHECK_URL || "";
const TOPUP_APPLY_URL = process.env.TOPUP_APPLY_URL || "";
const APPLY_SECRET = process.env.TOPUP_APPLY_SECRET || "";

async function hasIchancyAccount(phone) {
  if (!ACCOUNT_CHECK_URL) return null;
  try {
    const r = await axios.get(ACCOUNT_CHECK_URL, {
      params: { phone },
      timeout: 8000,
    });
    return Boolean(r.data?.exists || r.data?.hasAccount);
  } catch (e) {
    console.error("Account check error:", e?.response?.data || e.message);
    return null;
  }
}

async function applyTopupToAccount({ phone, amount, ref, txid, method }) {
  if (!TOPUP_APPLY_URL) return { ok: false, reason: "NO_APPLY_ENDPOINT" };
  try {
    const r = await axios.post(
      TOPUP_APPLY_URL,
      { phone, amount, ref, txid, method, secret: APPLY_SECRET },
      { timeout: 10000 }
    );
    return { ok: true, status: r.status, data: r.data };
  } catch (e) {
    console.error("Topup apply error:", e?.response?.data || e.message);
    return { ok: false, reason: e.message };
  }
}

async function beginSignup(from, after) {
  flow.set(from, { step: "await_username", after });
  await sendWhatsAppText(
    from,
    "تمام—خلّينا ننشئ حسابك على ايشانسي.\nاكتب اسم اللاعب المطلوب (أحرف لاتينية A-Z وأرقام فقط، 3–20 حرف، بدون مسافات)."
  );
}
// معالجة رسالة واحدة
async function handleMessage(from, text) {
  const hist = convo.get(from) || [];

  // ====== تدفق الشحن ======
  const tf = topupFlow.get(from);
  if (tf?.step === "ask_method") {
    const method = normalizeMethod(text);
    if (!method) {
      await sendWhatsAppText(from, "ما فهمت الطريقة. " + listMethods());
      return;
    }
    const label = METHODS[method].label;
    topupFlow.set(from, { step: "ask_amount", method });
    await sendWhatsAppText(
      from,
      `اخترت: ${label}. قديش المبلغ اللي بدك تحوّله؟ (الحد الأدنى ${MIN_TOPUP.toLocaleString()} ل.س)`
    );
    return;
  }

  if (tf?.step === "ask_amount") {
    const amt = extractAmount(normalizeDigits(text));
    if (!amt || amt < MIN_TOPUP) {
      await sendWhatsAppText(
        from,
        `المبلغ غير صالح. اكتب رقم ≥ ${MIN_TOPUP.toLocaleString()} ل.س.`
      );
      return;
    }
    const account = getAccountFor(tf.method);
    if (!account) {
      await sendWhatsAppText(
        from,
        "طريقة الدفع مختارة بس تفاصيل الحساب غير متوفرة حاليًا. تواصل مع الدعم."
      );
      topupFlow.delete(from);
      return;
    }
    const label = METHODS[tf.method].label;
    topupFlow.set(from, {
      step: "ask_txid",
      method: tf.method,
      amount: amt,
      account,
    });
    await sendWhatsAppText(
      from,
      `تمام. حول ${amt.toLocaleString()} ل.س عبر ${label} على:\n${account}\nبعد التحويل ابعت رقم العملية/الإيصال.`
    );
    return;
  }

  if (tf?.step === "ask_txid") {
    const txid = (text || "").trim();
    if (!txid) {
      await sendWhatsAppText(from, "ابعت رقم العملية (أو صورة الإيصال).");
      return;
    }
    const ref = `TP-${Date.now()}`;
    const payload = {
      ref,
      from,
      method: tf.method,
      amount: tf.amount,
      account: tf.account,
      txid,
      ts: new Date().toISOString(),
    };

    const submit = await submitTopup(payload);
    topupFlow.delete(from);

    if (!submit?.ok) {
      await sendWhatsAppText(
        from,
        "وصلنا رقم العملية بس صار خطأ بالتحقق الأولي. جرّب بعد شوي أو راسل الدعم."
      );
      return;
    }

    // فحص حساب ايشانسي
    const has = await hasIchancyAccount(from);
    if (has === true) {
      const apply = await applyTopupToAccount({
        phone: from,
        amount: tf.amount,
        ref,
        txid,
        method: tf.method,
      });
      if (apply.ok) {
        await sendWhatsAppText(
          from,
          `تم استلام العملية (${ref}) وتمت إضافة ${tf.amount.toLocaleString()} ل.س إلى حسابك بنجاح.`
        );
      } else {
        await sendWhatsAppText(
          from,
          `تم استلام العملية (${ref})، بس صار خلل بتثبيت الرصيد على الحساب. فريق الدعم بيتابعك حالًا.`
        );
      }
      return;
    }

    if (has === false) {
      await sendWhatsAppText(
        from,
        "ما لقينا حساب ايشانسي مرتبط برقمك. رح نبدأ إنشاء حساب ونطبّق رصيد الشحن عليه مباشرة بعد الإنهاء."
      );
      await beginSignup(from, {
        kind: "apply_topup_after_signup",
        data: { ref, txid, amount: tf.amount, method: tf.method }, // ← انتبه tf.method
      });
      return; // مهم: ما نكمل للرسائل اللي بعد
    }

    // has === null
    await sendWhatsAppText(
      from,
      `تسجّلت العملية (${ref}). إذا ما عندك حساب ايشانسي، فيك تكتب: تسجيل حساب — ومنطبّق الرصيد بعد الإنشاء.`
    );
    return;
  }

  // ====== تدفّق التسجيل ======
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
    const password = (text || "").trim();
    if (!password) {
      await sendWhatsAppText(from, "اكتب كلمة سر صالحة.");
      return;
    }
    const name = f.name;
    const after = f.after; // ← كان ناقص
    flow.delete(from);

    await sendWhatsAppText(
      from,
      `تمام—سجّلنا البيانات:\nالاسم: ${name}\nكلمة السر: تم استلامها.`
    );

    if (after?.kind === "apply_topup_after_signup") {
      const { ref, txid, amount, method } = after.data || {};
      const apply = await applyTopupToAccount({
        phone: from,
        amount,
        ref,
        txid,
        method,
      });
      if (apply.ok) {
        await sendWhatsAppText(
          from,
          `تم إنشاء الحساب وتثبيت ${amount.toLocaleString()} ل.س على حسابك بنجاح.`
        );
      } else {
        await sendWhatsAppText(
          from,
          `تم إنشاء الحساب، بس صار خلل بتثبيت الرصيد. فريق الدعم بيتابعك فورًا.`
        );
      }
      return;
    }

    return;
  }

  // ====== نيّات فورية ======
  const intent = routeIntent(text);

  if (intent === "signup") {
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
    topupFlow.set(from, { step: "ask_method" });
    await sendWhatsAppText(
      from,
      "تمام—بدنا طريقة الدفع أولاً. " + listMethods()
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

  // ====== RAG ======
  try {
    const { text: ctx, score, hits } = await makeContext(text, { k: 3 });
    console.log("RAG score:", score, "hit:", hits[0]?.id);

    if (score >= DIRECT_ANSWER && hits[0]) {
      const firstLine = hits[0].text.split("\n")[0].trim();
      await sendWhatsAppText(from, firstLine);
      return;
    }

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
  }

  // ====== Fallback ======
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
