// scripts/test_rag.js
require("dotenv").config();
const path = require("path");
const { makeContext } = require("../src/services/rag");

(async () => {
  try {
    const query = process.argv.slice(2).join(" ") || "كيف أسحب الرصيد؟";
    const { text, score, hits } = await makeContext(query, {
      k: 3,
      sep: "\n---\n",
    });

    console.log("🔎 السؤال:", query);
    console.log("📊 أعلى درجة:", Number(score).toFixed(4));

    if (!hits?.length) {
      console.log(
        "⚠️ لا توجد نتائج. تأكّد من أن الفهرس غير فارغ وأن المسار صحيح."
      );
      const expected = path.join(__dirname, "../data/index.json");
      console.log("📁 المسار الافتراضي الذي يتوقعه rag.js:", expected);
      process.exit(0);
    }

    console.log("\n🏆 أفضل النتائج:");
    hits.forEach((h, i) => {
      const id = h.id || h.title || "(بدون عنوان)";
      const sc = typeof h.score === "number" ? h.score.toFixed(4) : "—";
      console.log(`${i + 1}. ${id}  (score: ${sc})`);
    });

    console.log("\n🧩 مقتطف من السياق:\n");
    console.log(text.slice(0, 800));
    if (text.length > 800) console.log("\n... (تم قصّ السياق للعرض فقط)\n");
  } catch (e) {
    console.error("❌ Test RAG error:", e?.response?.data || e.message);
    process.exit(1);
  }
})();
