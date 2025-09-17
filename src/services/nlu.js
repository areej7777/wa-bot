// src/services/nlu.js
const AR = {
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
const toLatin = (s) => (s || "").replace(/[٠-٩]/g, (d) => AR[d]);
const norm = (s) =>
  toLatin((s || "").normalize("NFKC"))
    .replace(/[^\S\r\n]+/g, " ")
    .trim()
    .toLowerCase();

const INTENTS = {
  signup:
    /(?:(?:انشا|انشاء|إنشاء|أنشئ|انشئ|افتح|أفتح|فتح|سجّل|سجل|تسجيل|اعمل|عمل)\s*(?:حساب|اكونت)|بد[يي]\s*(?:انشئ|أنشئ|اعمل|افتح)\s*حساب|create\s*account|sign\s*up|register)/i,

  topup: /(شحن|اشحن|top ?up|رصيد|recharge|شحن حساب)/i,
  withdraw: /(سحب|withdraw|تحويل أموال|سحب رصيد)/i,
  link: /(رابط|لينك|website|site|موقع)/i,
  limits_withdraw: /(اقل|أدنى|ادنى).{0,8}(سحب)/i,
  limits_topup: /(اقل|أدنى|ادنى).{0,8}(شحن)/i,
  pricing: /(سعر|اسعار|باقات|العروض)/i,
};

function detectIntent(t) {
  t = norm(t);
  for (const [k, re] of Object.entries(INTENTS)) if (re.test(t)) return k;
  return null;
}

// helpers المستعملة بباقي الفلوات – اتركها متل ما هي إذا عندك نسخة أقدم:
function extractAmount(t) {
  t = norm(t);
  const m = t.match(/\b([0-9][0-9\.,]{0,9})\b/);
  return m ? parseInt(m[1].replace(/[^\d]/g, ""), 10) : null;
}

function extractMethod(t) {
  t = norm(t);
  if (/(syriatel|سيريتيل|كاش)/.test(t)) return "سيريتيل كاش";
  if (/(usdt|تيثر)/.test(t)) return "USDT";
  if (/(bemo|بيمو)/.test(t)) return "بيمو";
  if (/(payeer|بايير)/.test(t)) return "بايير";
  if (/(هرم)/.test(t)) return "هرم";
  return null;
}
function extractAccount(t) {
  t = norm(t);
  const m = t.match(/\b(\d{6,20})\b/);
  return m ? m[1] : null;
}

module.exports = {
  norm,
  detectIntent,
  extractAmount,

  extractMethod,
  extractAccount,
};
