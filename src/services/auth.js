// src/services/auth.js
// 🔒 ملاحظة: هذا موك للتجربة فقط — لا يقوم بإنشاء حساب فعلي.

async function createAccount({ phone, username, password }) {
  // ما منخزّن/نطبع كلمة السر إطلاقًا
  // تأخير بسيط حتى تحسّها طبيعية (اختياري)
  await new Promise((r) => setTimeout(r, 200));
  return { ok: true, userId: `mock_${Date.now()}` };
}

/* ==================  نسخة الإنتاج (معلّقة) ==================
  const axios = require("axios");
  const SIGNUP_URL   = process.env.SIGNUP_URL;   // مثال: https://api.yourdomain.com/signup
  const SIGNUP_TOKEN = process.env.SIGNUP_TOKEN || "";
  
  async function createAccount({ phone, username, password }) {
    const res = await axios.post(
      SIGNUP_URL,
      { phone, username, password },
      {
        headers: SIGNUP_TOKEN ? { Authorization: `Bearer ${SIGNUP_TOKEN}` } : {},
        timeout: 10000,
      }
    );
    return res.data; // توقّع { ok: true, userId: '...' }
  }
  ================================================================ */

module.exports = { createAccount };
