const cron = require('node-cron');
const Watchlist = require('./models/watchlist');
const { getAIAnalysis } = require('./ai');
const { getMarketSentiment, getMarketTrend, getStockPrice } = require('./data');
const { broadcast } = require('./bot');

let latestBriefingData = "ยังไม่มีข้อมูลสรุปสำหรับวันนี้ครับเจ้านาย";

const sendDailyBriefing = async () => {
  console.log('[Briefing] Preparing daily briefing...');
  
  try {
    const userIds = await Watchlist.distinct('userId');
    const [sentiment, trend] = await Promise.all([
      getMarketSentiment(),
      getMarketTrend()
    ]);

    let globalBriefing = "";

    for (const userId of userIds) {
      const stocks = await Watchlist.find({ userId });
      if (stocks.length === 0) continue;

      let portfolioText = '';
      let totalValue = 0;

      for (const s of stocks) {
        try {
          const q = await getStockPrice(s.symbol);
          const value = q.price * s.amount;
          totalValue += value;
          const pnl = ((q.price - s.avgPrice) / s.avgPrice) * 100;
          portfolioText += `- ${s.symbol}: $${q.price} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%)\n`;
        } catch (e) {}
      }

      const prompt = `จัดทำรายงานสรุปภาวะตลาดและพอร์ตการลงทุนรอบเช้าให้เจ้านาย:
      - สภาวะตลาด (Fear & Greed): ${sentiment?.stock?.score} (${sentiment?.stock?.rating})
      - ดัชนีหลัก: ${trend.map(t => `${t.name} ${t.status}`).join(', ')}
      - พอร์ตของเจ้านาย: 
      ${portfolioText}
      - มูลค่ารวม: $${totalValue.toLocaleString()}

      ช่วยสรุปสั้นๆ ว่าวันนี้ควรระวังอะไร หรือมีตัวไหนน่าจับตามองเป็นพิเศษไหม ตอบแบบสุภาพและเป็นกันเองในฐานะ Jarvis`;

      const briefing = await getAIAnalysis(prompt, "คุณคือ Jarvis ผู้ช่วยส่วนตัวที่เก่งที่สุด สรุปรายงานตอนเช้าให้เจ้านายแบบอ่านง่ายและมีกำลังใจ");
      globalBriefing = briefing;

      await broadcast(userId, `☀️ **Jarvis Morning Briefing**\n\n${briefing}\n\n📊 **สรุปพอร์ต:**\n${portfolioText}\n💰 **มูลค่ารวม:** $${totalValue.toLocaleString()}`);
    }
    
    latestBriefingData = globalBriefing || "ส่งรายงานสรุปเรียบร้อยแล้วครับเจ้านาย";
    console.log('[Briefing] Daily briefing sent to all users');
  } catch (error) {
    console.error('[Briefing] Error:', error.message);
  }
};

const startBriefingScheduler = () => {
  cron.schedule('30 1 * * *', sendDailyBriefing);
  console.log('[Briefing] Scheduler started (08:30 AM TH Time)');
};

module.exports = { startBriefingScheduler, sendDailyBriefing, getLatestBriefing: () => latestBriefingData };
