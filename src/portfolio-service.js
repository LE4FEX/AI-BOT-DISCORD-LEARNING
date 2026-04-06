const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');
const Snapshot = require('./models/snapshot');
const { getStockPrice } = require('./data');

/**
 * บันทึกภาพรวมพอร์ต (Snapshot) รายวัน
 */
const takePortfolioSnapshot = async () => {
  console.log('[Portfolio] Taking portfolio snapshot...');
  try {
    const userIds = await Watchlist.distinct('userId');
    for (const userId of userIds) {
      const stocks = await Watchlist.find({ userId });
      let totalValue = 0;
      let totalCost = 0;

      for (const s of stocks) {
        try {
          const q = await getStockPrice(s.symbol);
          totalValue += (q.price * s.amount);
          totalCost += (s.avgPrice * s.amount);
        } catch (e) {}
      }

      if (totalCost > 0) {
        const profit = totalValue - totalCost;
        const profitPercent = (profit / totalCost) * 100;

        await Snapshot.create({
          userId,
          totalValue,
          totalCost,
          profit,
          profitPercent,
          date: new Date()
        });
      }
    }
    console.log('[Portfolio] Snapshot completed');
  } catch (error) {
    console.error('[Portfolio] Snapshot error:', error.message);
  }
};

/**
 * อัปเดตพอร์ตหุ้นและบันทึกรายการธุรกรรม (DCA Logic)
 */
const updatePortfolio = async (userId, symbol, amount, price, isDca = false, fee = 0) => {
  symbol = symbol.toUpperCase();
  let stock = await Watchlist.findOne({ userId, symbol });

  if (stock) {
    const totalCost = (stock.amount * stock.avgPrice) + (amount * price) + fee;
    const totalAmount = stock.amount + amount;
    stock.avgPrice = totalCost / totalAmount;
    stock.amount = totalAmount;
    await stock.save();
  } else {
    const avgPrice = ((amount * price) + fee) / amount;
    stock = await Watchlist.create({
      userId,
      symbol,
      amount,
      avgPrice
    });
  }

  await Transaction.create({
    userId,
    symbol,
    type: 'BUY',
    amount,
    price,
    fee,
    isDca
  });

  return stock;
};

/**
 * บันทึกเงินปันผลและลดต้นทุนเฉลี่ย
 */
const addDividend = async (userId, symbol, dividendAmount) => {
  symbol = symbol.toUpperCase();
  const stock = await Watchlist.findOne({ userId, symbol });
  if (!stock) throw new Error(`ไม่พบหุ้น ${symbol} ในพอร์ตของคุณ`);

  const totalCost = (stock.amount * stock.avgPrice) - dividendAmount;
  stock.avgPrice = totalCost / stock.amount;
  await stock.save();

  await Transaction.create({
    userId,
    symbol,
    type: 'DIVIDEND',
    amount: 0,
    price: dividendAmount,
    fee: 0
  });

  return stock;
};

module.exports = { updatePortfolio, addDividend, takePortfolioSnapshot };
