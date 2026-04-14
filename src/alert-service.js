const Alert = require('./models/alert');
const Watchlist = require('./models/watchlist');
const VolatilityLog = require('./models/volatility-log');
const { getStockPrice, getStockNews } = require('./data');
const { getAIAnalysis } = require('./ai');
const { broadcast } = require('./bot');

const VOLATILITY_THRESHOLD = 3.0; // แจ้งเตือนเมื่อขยับเกิน 3%

const checkAlerts = async () => {
  const activeAlerts = await Alert.find({ active: true });
  const allWatchlists = await Watchlist.find();
  
  if (activeAlerts.length === 0 && allWatchlists.length === 0) return;

  console.log(`[Alert] Running checks: ${activeAlerts.length} targets, ${allWatchlists.length} watchlist items...`);

  // กลุ่ม Symbol ทั้งหมดที่ต้องเช็ค (ทั้งจาก Alert และ Watchlist)
  const symbols = [...new Set([
    ...activeAlerts.map(a => a.symbol),
    ...allWatchlists.map(w => w.symbol)
  ])];

  const today = new Date().toISOString().split('T')[0];

  for (const symbol of symbols) {
    try {
      const q = await getStockPrice(symbol);
      const currentPrice = q.price;
      const prevClose = q.previousClose;
      const changePercent = ((currentPrice - prevClose) / prevClose) * 100;

      // --- 1. ตรวจสอบเป้าหมายราคาที่ตั้งไว้ (Manual Alerts) ---
      const targets = activeAlerts.filter(a => a.symbol === symbol);
      for (const alert of targets) {
        let triggered = false;
        if (alert.type === 'above' && currentPrice >= alert.targetPrice) triggered = true;
        if (alert.type === 'below' && currentPrice <= alert.targetPrice) triggered = true;

        if (triggered) {
          await broadcast(alert.userId, `🎯 **Price Target Reached!**\n📈 หุ้น: **${symbol}**\n💰 ราคาปัจจุบัน: **$${currentPrice.toFixed(2)}**\n🎯 เป้าหมาย: ${alert.type === 'above' ? 'สูงกว่า' : 'ต่ำกว่า'} $${alert.targetPrice}`);
          alert.active = false;
          await alert.save();
        }
      }

      // --- 2. ตรวจสอบความผันผวนอัตโนมัติ (Auto Volatility) ---
      const absChange = Math.abs(changePercent);
      if (absChange >= VOLATILITY_THRESHOLD) {
        const holders = allWatchlists.filter(w => w.symbol === symbol);
        const userIds = [...new Set(holders.map(h => h.userId))];

        for (const userId of userIds) {
          // ตรวจสอบว่าวันนี้เตือนไปหรือยัง (หรือขยับแรงกว่าเดิม 2% ถึงจะเตือนซ้ำ)
          const log = await VolatilityLog.findOne({ userId, symbol, date: today });
          if (!log || Math.abs(changePercent - log.lastTriggeredPercent) >= 2.0) {
            
            let aiAnalysis = "No AI analysis for small movements.";
            
            // --- 3. GATEKEEPING: AI วิเคราะห์เฉพาะเมื่อผันผวนสูง (เช่น > 5%) ---
            if (absChange >= 5.0) {
              const news = await getStockNews(symbol);
              aiAnalysis = await getAIAnalysis(`หุ้น ${symbol} ขยับ ${changePercent.toFixed(2)}% ราคา $${currentPrice} ข่าวล่าสุด: ${news}`, "คุณคือ Jarvis AI วิเคราะห์ความผันผวนของราคาหุ้น แจ้งเตือนกระชับ ตรงประเด็น");
            } else {
              aiAnalysis = "⚠️ ราคาขยับปกติ (Vol < 5%) ระบบจึงไม่ได้เรียก AI เพื่อประหยัด Quota";
            }

            await broadcast(userId, `⚠️ **Jarvis Alert: Volatility Detected!**\n${changePercent >= 0 ? '🚀' : '📉'} **${symbol}** ขยับแรง **${changePercent.toFixed(2)}%** ในวันนี้!\n💰 ราคา: $${currentPrice.toFixed(2)} (ปิดก่อนหน้า: $${prevClose.toFixed(2)})\n\n🤖 **Jarvis Analysis:**\n${aiAnalysis}`);

            if (log) {
              log.lastTriggeredPercent = changePercent;
              await log.save();
            } else {
              await VolatilityLog.create({ userId, symbol, date: today, lastTriggeredPercent: changePercent });
            }
          }
        }
      }

    } catch (error) {
      console.error(`[Alert/Volatility] Error for ${symbol}:`, error.message);
    }
  }
};

const startAlertScheduler = () => {
  // ตรวจสอบทุก 10 นาที
  setInterval(checkAlerts, 10 * 60 * 1000);
  console.log('[Alert/Volatility] Scheduler started');
};

module.exports = { checkAlerts, startAlertScheduler };