const Watchlist = require('./models/watchlist');
const NewsLog = require('./models/news-log');
const { getStockNews } = require('./data');
const { getAIAnalysis } = require('./ai');
const { broadcast } = require('./bot');
const crypto = require('crypto');

// --- NEWS BATCHING & FILTERING CONFIG ---
const NEWS_BATCH_INTERVAL = 30 * 60 * 1000; // 30 mins
const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours
const IMPORTANT_KEYWORDS = ["Earnings", "SEC", "CEO", "Dividend", "IPO", "Merger", "Acquisition", "Fed"];

let newsQueue = [];

const checkNewsUpdates = async () => {
  console.log('[News] Checking for news updates...');
  const symbols = await Watchlist.distinct('symbol');
  
  for (const symbol of symbols) {
    try {
      const newsString = await getStockNews(symbol);
      if (newsString === 'No news found' || newsString === 'News unavailable') continue;

      const newsItems = newsString.split(' | ');
      for (const item of newsItems) {
        // --- 3. GATEKEEPING (Keyword Filtering) ---
        const hasKeyword = IMPORTANT_KEYWORDS.some(kw => item.toLowerCase().includes(kw.toLowerCase()));
        const isWatchlistSymbol = symbols.some(s => item.includes(s));
        if (!hasKeyword && !isWatchlistSymbol) continue; // ข้ามข่าวที่ไม่สำคัญ

        const titleHash = crypto.createHash('md5').update(item).digest('hex');

        // --- 2. RESPONSE CACHING (Check MongoDB) ---
        const existingResult = await NewsLog.findOne({ 
          $or: [{ titleHash }, { title: item }],
          date: { $gt: new Date(Date.now() - CACHE_TTL) }
        });

        if (existingResult && existingResult.summary) {
          // ถ้าเคยสรุปแล้ว ใช้ของเดิม (ข้ามการส่งเข้า Queue เพื่อสรุปซ้ำ)
          await notifyUsers(symbol, item, existingResult.summary);
          continue;
        }

        // เพิ่มเข้า Queue เพื่อรอสรุปแบบ Batch
        if (!newsQueue.find(q => q.titleHash === titleHash)) {
          newsQueue.push({ symbol, item, titleHash });
        }
      }
    } catch (error) {
      console.error(`[News] Error for ${symbol}:`, error.message);
    }
  }
};

const processNewsQueue = async () => {
  if (newsQueue.length === 0) return;

  console.log(`[News] Processing batch of ${newsQueue.length} items...`);
  const batch = [...newsQueue];
  newsQueue = [];

  // รวมข่าวเป็นก้อนเดียวเพื่อประหยัด Tokens (Batching)
  const combinedPrompt = batch.map((n, i) => `${i+1}. [${n.symbol}] ${n.item}`).join('\n');
  const aiPrompt = `สรุปข่าวหุ้นต่อไปนี้แบบสั้นๆ กระชับ (ข่าวละ 1 ประโยค) และระบุ Sentiment (Bullish/Bearish/Neutral):\n${combinedPrompt}\nตอบเป็นภาษาไทย`;

  try {
    const analysis = await getAIAnalysis(aiPrompt, "คุณคือ AI ผู้สรุปข่าวหุ้นแบบ Batch ประหยัดเวลาและแม่นยำ");
    const summaries = analysis.split('\n').filter(s => s.trim() !== '');

    for (let i = 0; i < batch.length; i++) {
      const summary = summaries[i] || summaries[0]; // Fallback
      await NewsLog.create({ 
        symbol: batch[i].symbol, 
        title: batch[i].item, 
        titleHash: batch[i].titleHash,
        summary: summary // เพิ่ม field summary ใน NewsLog
      });
      await notifyUsers(batch[i].symbol, batch[i].item, summary);
    }
  } catch (error) {
    console.error('[News] Batch processing error:', error.message);
  }
};

const notifyUsers = async (symbol, item, analysis) => {
  const holders = await Watchlist.find({ symbol });
  const userIds = [...new Set(holders.map(h => h.userId))];
  for (const userId of userIds) {
    await broadcast(userId, `📰 **News Alert: ${symbol}**\n\n${item}\n\n🤖 **Jarvis Summary:**\n${analysis}`);
  }
};

const startNewsScheduler = () => {
  // ตรวจสอบข่าวทุก 30 นาที
  setInterval(checkNewsUpdates, 30 * 60 * 1000);
  // ประมวลผล AI ทุก 30 นาที (News Batching)
  setInterval(processNewsQueue, NEWS_BATCH_INTERVAL);
  
  console.log('[News] Scheduler started');
};

module.exports = { checkNewsUpdates, startNewsScheduler };