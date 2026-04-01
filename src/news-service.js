const Watchlist = require('./models/watchlist');
const NewsLog = require('./models/news-log');
const { getStockNews } = require('./data');
const { getAIAnalysis } = require('./ai');
const { broadcast } = require('./bot');
const crypto = require('crypto');

const checkNewsUpdates = async () => {
  console.log('[News] Checking for news updates...');
  
  // 1. ดึงหุ้นทั้งหมดที่มีคนถืออยู่ในพอร์ต
  const symbols = await Watchlist.distinct('symbol');
  
  for (const symbol of symbols) {
    try {
      const newsString = await getStockNews(symbol);
      if (newsString === 'No news found' || newsString === 'News unavailable') continue;

      // แยกข่าวรายหัวข้อ (ใช้ตัวแบ่ง | ที่เราทำไว้ใน getStockNews)
      const newsItems = newsString.split(' | ');

      for (const item of newsItems) {
        const titleHash = crypto.createHash('md5').update(item).digest('hex');

        // 2. ตรวจสอบว่าเคยส่งข่าวนี้นไปหรือยัง
        const exists = await NewsLog.findOne({ titleHash });
        if (exists) continue;

        // 3. ใช้ AI วิเคราะห์ความสำคัญและ Sentiment
        const aiPrompt = `วิเคราะห์หัวข้อข่าวหุ้น ${symbol}: "${item}" 
        1. ข่าวนี้ส่งผลกระทบต่อราคาหุ้นในระดับไหน (Low/Medium/High)?
        2. Sentiment เป็นอย่างไร (Bullish/Bearish/Neutral)?
        3. สรุปสั้นๆ 1 ประโยค
        ตอบเป็นภาษาไทยแบบสั้นๆ กระชับ`;

        const analysis = await getAIAnalysis(item, "คุณคือ AI ผู้คัดกรองข่าวหุ้น เน้นความกระชับและแม่นยำ");

        // 4. บันทึกข่าวนลง Log
        await NewsLog.create({ symbol, titleHash });

        // 5. แจ้งเตือนผู้ใช้ทุกคนที่ถือหุ้นนี้
        const holders = await Watchlist.find({ symbol });
        const userIds = [...new Set(holders.map(h => h.userId))];

        for (const userId of userIds) {
          await broadcast(userId, `📰 **News Alert: ${symbol}**\n\n${item}\n\n🤖 **Jarvis Analysis:**\n${analysis}`);
        }
      }
    } catch (error) {
      console.error(`[News] Error for ${symbol}:`, error.message);
    }
  }
};

const startNewsScheduler = () => {
  // ตรวจสอบข่าวทุก 1 ชั่วโมง เพื่อไม่ให้รบกวนผู้ใช้เกินไป
  setInterval(checkNewsUpdates, 60 * 60 * 1000);
  console.log('[News] Scheduler started');
};

module.exports = { checkNewsUpdates, startNewsScheduler };