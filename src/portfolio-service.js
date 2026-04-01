const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');

/**
 * อัปเดตพอร์ตหุ้นและบันทึกรายการธุรกรรม (DCA Logic)
 * @param {string} userId - ID ของผู้ใช้
 * @param {string} symbol - ชื่อย่อหุ้น
 * @param {number} amount - จำนวนหุ้นที่ซื้อเพิ่ม
 * @param {number} price - ราคาที่ซื้อต่อหุ้น
 * @param {boolean} isDca - เป็นรายการจากระบบ DCA หรือไม่
 * @param {number} fee - ค่าธรรมเนียม (USD)
 */
const updatePortfolio = async (userId, symbol, amount, price, isDca = false, fee = 0) => {
  symbol = symbol.toUpperCase();
  
  // 1. ค้นหาหุ้นในพอร์ตเดิม
  let stock = await Watchlist.findOne({ userId, symbol });

  if (stock) {
    // สูตรคำนวณต้นทุนเฉลี่ย: ((จำนวนเดิม * ราคาเดิม) + (จำนวนใหม่ * ราคาใหม่) + ค่าธรรมเนียม) / จำนวนรวมทั้งหมด
    const totalCost = (stock.amount * stock.avgPrice) + (amount * price) + fee;
    const totalAmount = stock.amount + amount;
    
    stock.avgPrice = totalCost / totalAmount;
    stock.amount = totalAmount;
    await stock.save();
  } else {
    // ถ้ายังไม่มีหุ้นนี้ในพอร์ต ให้สร้างใหม่
    // ต้นทุนแรกเข้า = (จำนวน * ราคา) + ค่าธรรมเนียม
    const avgPrice = ((amount * price) + fee) / amount;
    stock = await Watchlist.create({
      userId,
      symbol,
      amount,
      avgPrice
    });
  }

  // 2. บันทึกประวัติการทำรายการ (Transaction)
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
 * @param {string} userId 
 * @param {string} symbol 
 * @param {number} dividendAmount - ยอดเงินปันผลรวม (USD)
 */
const addDividend = async (userId, symbol, dividendAmount) => {
  symbol = symbol.toUpperCase();
  const stock = await Watchlist.findOne({ userId, symbol });
  
  if (!stock) throw new Error(`ไม่พบหุ้น ${symbol} ในพอร์ตของคุณ`);

  // เงินปันผลจะช่วยลดต้นทุนเฉลี่ย (Net Cost Reduction)
  // ต้นทุนรวมเดิม = amount * avgPrice
  // ต้นทุนรวมใหม่ = (amount * avgPrice) - dividendAmount
  // avgPrice ใหม่ = ((amount * avgPrice) - dividendAmount) / amount
  const totalCost = (stock.amount * stock.avgPrice) - dividendAmount;
  stock.avgPrice = totalCost / stock.amount;
  await stock.save();

  // บันทึกรายการ
  await Transaction.create({
    userId,
    symbol,
    type: 'DIVIDEND',
    amount: 0,
    price: dividendAmount, // บันทึกยอดรวมปันผลในช่องราคา
    fee: 0
  });

  return stock;
};

module.exports = { updatePortfolio, addDividend };