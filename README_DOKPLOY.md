# نشر بوت واتساب على Dokploy (Traefik + HTTPS)

## المتطلبات
- حساب Meta WhatsApp Cloud API (Phone Number ID + Token)
- مفتاح OpenAI (اختياري للذكاء)
- خادم عليه Dokploy شغال
- دومين موجّه للخادم (A/CNAME) للحصول على HTTPS عبر Traefik/Let's Encrypt

> ملاحظة: `traefik.me` في Dokploy متاح كمجاني لكنه **HTTP افتراضيًا**؛ واتساب يتطلب **HTTPS**. استخدم دومينك أو اربط شهادة يدويًا.

## خطوات سريعة
1) انسخي هذا المشروع إلى مستودع Git (أو ارفعيه مباشرة في Dokploy).
2) في Dokploy → **Applications** → **Create Application**:
   - **Source**: Git أو Dockerfile
   - **Build Type**: Dockerfile
   - **Dockerfile Path**: `Dockerfile`
   - **Container Port**: `3000`
3) أدخلي **Environment**:
   - `PORT=3000`
   - `VERIFY_TOKEN=your-verify-token`
   - `WHATSAPP_TOKEN=EAAG...`
   - `PHONE_NUMBER_ID=...`
   - `GRAPH_VERSION=v20.0`
   - `OPENAI_API_KEY=sk-...` (اختياري)
4) **Deploy** التطبيق.
5) من تبويب **Domains**:
   - **Host**: `webhook.yourdomain.com`
   - **Path**: `/webhook`
   - **Container Port**: `3000`
   - **HTTPS**: ON
   - **Certificate**: Let's Encrypt
   - **Create**
6) اختبري التحقق (GET):
   ```
   https://webhook.yourdomain.com/webhook?hub.mode=subscribe&hub.verify_token=your-verify-token&hub.challenge=12345
   ```
   يجب أن يعيد `12345` و HTTP 200.
7) في Meta → **WhatsApp → Configuration**:
   - **Callback URL** = `https://webhook.yourdomain.com/webhook`
   - **Verify Token** = نفس القيمة أعلاه
   - **Verify & Save**
8) أضيفي رقمك إلى **Recipient List** → أرسلي رسالة للرقم التجريبي → راقبي لوج `/webhook`.

## اختبارات cURL
```bash
# فحص الهاتف المرتبط
curl -H "Authorization: Bearer $WHATSAPP_TOKEN"     "https://graph.facebook.com/v20.0/$PHONE_NUMBER_ID?fields=id,display_phone_number,verified_name"

# إرسال رسالة نصية
curl -X POST "https://graph.facebook.com/v20.0/$PHONE_NUMBER_ID/messages"     -H "Authorization: Bearer $WHATSAPP_TOKEN"     -H "Content-Type: application/json"     -d '{
    "messaging_product":"whatsapp",
    "to":"+9715XXXXXXXX",
    "type":"text",
    "text":{"body":"اختبار ✔️ Dokploy/Traefik"}
  }'
```

## ملاحظات
- تأكدي أن **الدومين يشير لخادم Dokploy** قبل طلب الشهادة.
- لو الدومين لا يعمل: افحصي **Container Port** يساوي `3000` في إعداد الدومين.
- استبدلي التخزين المؤقت للمحادثات بقاعدة بيانات عند الإنتاج.
