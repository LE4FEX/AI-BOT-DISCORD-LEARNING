const mongoose = require('mongoose');
const Dca = require('./models/dca');
const Watchlist = require('./models/watchlist');
const Snapshot = require('./models/snapshot');
const { getStockPrice } = require('./data');
const { broadcast } = require('./bot');

const { updatePortfolio } = require('./portfolio-service');

const takeDailySnapshot = async () => {
  console.log('[Snapshot] Running daily snapshot...');
  const users = await Watchlist.distinct('userId');

  for (const userId of users) {
    const stocks = await Watchlist.find({ userId });
    if (stocks.length === 0) continue;

    let totalValue = 0, totalCost = 0;

    for (const stock of stocks) {
      try {
        const q = await getStockPrice(stock.symbol);
        totalValue += q.price * stock.amount;
        totalCost += stock.avgPrice * stock.amount;
      } catch (e) {
        totalCost += stock.avgPrice * stock.amount;
        totalValue += stock.avgPrice * stock.amount; // Fallback
      }
    }

    const profit = totalValue - totalCost;
    const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;

    await Snapshot.create({ userId, totalValue, totalCost, profit, profitPercent });
  }
  console.log('[Snapshot] Daily snapshot completed');
};

const executeDcaPlans = async () => {
  const now = new Date();
  const duePlans = await Dca.find({ 
    isActive: true, 
    nextExecution: { $lte: now } 
  });

  if (duePlans.length === 0) return;

  console.log(`[DCA] Processing ${duePlans.length} plans...`);

  for (const plan of duePlans) {
    try {
      const { symbol, amount, userId, frequency } = plan;
      const { price } = await getStockPrice(symbol);

      // คำนวณค่าธรรมเนียมเบื้องต้น (เช่น 0.2%)
      const fee = amount * 0.002;
      const netAmount = amount - fee;
      const units = netAmount / price;

      // ใช้ Service กลางเพื่ออัปเดตพอร์ตและบันทึกรายการ
      await updatePortfolio(userId, symbol, units, price, true, fee);

      // 3. อัปเดต DCA Plan สำหรับครั้งถัดไป
      let nextDate = new Date(plan.nextExecution);
      while (nextDate <= now) {
        if (frequency === 'DAILY') nextDate.setDate(nextDate.getDate() + 1);
        else if (frequency === 'WEEKLY') nextDate.setDate(nextDate.getDate() + 7);
        else if (frequency === 'MONTHLY') nextDate.setMonth(nextDate.getMonth() + 1);
      }

      plan.lastExecution = now;
      plan.nextExecution = nextDate;
      await plan.save();

      // 4. แจ้งเตือนผู้ใช้
      await broadcast(userId, `🚀 **DCA Executed!**\n💎 หุ้น: **${symbol}**\n💵 ลงทุน: $${amount.toFixed(2)} (ค่าธรรมเนียม: $${fee.toFixed(2)})\n📈 ราคา: $${price.toFixed(2)}\n📦 ได้รับ: ${units.toFixed(4)} หุ้น`);

    } catch (error) {
      console.error(`[DCA] Failed for plan ${plan._id}:`, error.message);
    }
  }
};

const startDcaScheduler = () => {
  // รันทุกๆ 15 นาที เพื่อเช็คว่ามี DCA ตัวไหนถึงเวลาหรือยัง
  setInterval(executeDcaPlans, 15 * 60 * 1000);

  // รัน Snapshot วันละครั้ง (เช็คทุก 15 นาทีว่าถึงช่วงเที่ยงคืนหรือยัง)
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() < 15) {
      takeDailySnapshot();
    }
  }, 15 * 60 * 1000);

  console.log('[DCA] Scheduler started');
};

module.exports = { executeDcaPlans, startDcaScheduler, takeDailySnapshot };