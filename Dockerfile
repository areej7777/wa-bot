# ===== مرحلة تثبيت الاعتمادات =====
FROM node:20-bookworm-slim AS deps
ENV NODE_ENV=production
# أدوات أساسية لأي موديولات native مستقبلًا
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
# تثبيت نظيف سريع للإنتاج
RUN npm ci --omit=dev

# ===== مرحلة التشغيل =====
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
# Healthcheck (اختياري بس مفيد)
HEALTHCHECK --interval=30s --timeout=3s CMD curl -fsS http://127.0.0.1:3000/ || exit 1
CMD ["node", "src/index.js"]
