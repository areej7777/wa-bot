// src/services/whatsapp.js
const axios = require("axios");

const API_BASE = "https://graph.facebook.com/v2.0";

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

async function sendWhatsAppText(to, body) {
  if (!TOKEN || !PHONE_NUMBER_ID) {
    throw new Error("Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID");
  }
  try {
    const url = `${API_BASE}/${PHONE_NUMBER_ID}/messages`;
    await axios.post(
      url,
      { messaging_product: "whatsapp", to, type: "text", text: { body } },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );
  } catch (e) {
    console.error("WA send error:", e?.response?.data || e.message);
    throw e;
  }
}

module.exports = { sendWhatsAppText };
