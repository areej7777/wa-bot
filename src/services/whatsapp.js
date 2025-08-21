// src/services/whatsapp.js
require("dotenv").config();
const axios = require("axios");

const GRAPH = process.env.GRAPH_VERSION || "v20.0";
const BASE = `https://graph.facebook.com/${GRAPH}`;

async function sendWhatsAppText(to, text) {
  const url = `${BASE}/${process.env.PHONE_NUMBER_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: String(text).slice(0, 4096) },
  };
  const res = await axios.post(url, payload, { headers, timeout: 15000 });
  return res.data;
}

module.exports = { sendWhatsAppText };
