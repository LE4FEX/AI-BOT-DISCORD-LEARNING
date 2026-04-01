const mongoose = require('mongoose');
const Dca = require('./models/dca');
const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');
const { getStockPrice } = require('./data');
const { broadcast } = require('./bot');

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
      
      const units = amount / price;

      // 1. อัปเดต Watchlist (พอร์ต)
      const existing = await Watchlist.findOne({ userId, symbol });
      if (existing) {
        existing.avgPrice = ((existing.amount * existing.avgPrice) + amount) / (existing.amount + units);
        existing.amount += units;
        await existing.save();
      } else {
        await Watchlist.create({ userId, symbol, amount: units, avgPrice: price });
      }

      // 2. บันทึก Transaction
      await Transaction.create({ userId, symbol, type: 'BUY', amount: units, price, isDca: true });

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
      await broadcast(userId, `🚀 **DCA Executed!**\n💎 หุ้น: **${symbol}**\n💵 ลงทุน: $${amount.toFixed(2)}\n📈 ราคา: $${price.toFixed(2)}\n📦 ได้รับ: ${units.toFixed(4)} หุ้น`);

    } catch (error) {
      console.error(`[DCA] Failed for plan ${plan._id}:`, error.message);
    }
  }
};

const startDcaScheduler = () => {
  // รันทุกๆ 15 นาที เพื่อเช็คว่ามี DCA ตัวไหนถึงเวลาหรือยัง
  setInterval(executeDcaPlans, 15 * 60 * 1000);
  console.log('[DCA] Scheduler started');
};

module.exports = { executeDcaPlans, startDcaScheduler };