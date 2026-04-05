const express = require('express');
const mongoose = require('mongoose');
const { setupBot } = require('./bot');
const { env } = require('./config');
const { startDcaScheduler } = require('./dca-service');
const { startAlertScheduler } = require('./alert-service');
const { startNewsScheduler } = require('./news-service');
const { startBriefingScheduler } = require('./briefing-service');
const path = require('path');

const app = express();
const port = env.port;

// เปิดใช้งานการส่งไฟล์ Static (สำหรับ Dashboard)
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/ping', (req, res) => res.status(200).send('pong'));

// --- CACHING LOGIC ---
const priceCache = new Map();
const CACHE_TTL = 15 * 60 * 1000;
const getCachedPrice = async (symbol) => {
  const cached = priceCache.get(symbol);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) return cached.data;
  const { getStockPrice } = require('./data');
  const priceData = await getStockPrice(symbol);
  priceCache.set(symbol, { data: priceData, timestamp: Date.now() });
  return priceData;
};

// --- API ENDPOINTS ---

app.get('/api/stats', async (req, res) => {
  try {
    const Watchlist = require('./models/watchlist');
    const users = await Watchlist.distinct('userId');
    const totalUsers = users.length;
    const totalStocks = await Watchlist.countDocuments();
    res.json({ totalUsers, totalStocks, status: 'online' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/portfolio-detailed', async (req, res) => {
  try {
    const Watchlist = require('./models/watchlist');
    const { getStockHistory, calculateRSI } = require('./data');
    const stocks = await Watchlist.find();
    const detailed = await Promise.all(stocks.map(async (s) => {
      try {
        const [q, history] = await Promise.all([getCachedPrice(s.symbol), getStockHistory(s.symbol)]);
        const rsi = calculateRSI(history);
        const profitPercent = ((q.price - s.avgPrice) / s.avgPrice) * 100;
        let score = 0;
        if (rsi) score += Math.max(0, (70 - rsi) * 1.2);
        if (q.price < s.avgPrice) score += 20;
        return {
          symbol: s.symbol, amount: s.amount, avgPrice: s.avgPrice, currentPrice: q.price,
          profitPercent, rsi: rsi ? rsi.toFixed(2) : 'N/A', sector: s.sector || 'Other',
          score: Math.min(100, Math.round(score))
        };
      } catch (e) { return { symbol: s.symbol, error: true }; }
    }));
    res.json(detailed.filter(d => !d.error));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/portfolio-summary', async (req, res) => {
  try {
    const Watchlist = require('./models/watchlist');
    const stocks = await Watchlist.find();
    let totalValue = 0, totalCost = 0;
    const sectorMap = {};
    for (const s of stocks) {
      try {
        const q = await getCachedPrice(s.symbol);
        const val = q.price * s.amount;
        totalValue += val;
        totalCost += (s.avgPrice * s.amount);
        const sec = s.sector || 'Other';
        sectorMap[sec] = (sectorMap[sec] || 0) + val;
      } catch (e) {}
    }
    res.json({ totalValue, totalProfit: totalValue - totalCost, profitPercent: totalCost > 0 ? (totalValue-totalCost)/totalCost*100 : 0, sectorAllocation: sectorMap });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai-simulate', express.json(), async (req, res) => {
  try {
    const { getAIAnalysis } = require('./ai');
    const { scenario } = req.body;
    const prompt = `วิเคราะห์สถานการณ์สมมติ: "${scenario}" สำหรับพอร์ตการลงทุนปัจจุบัน ช่วยบอกความเสี่ยงและคำแนะนำสั้นๆ`;
    const result = await getAIAnalysis(prompt, "คุณคือ Jarvis Simulator");
    res.json({ result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/trending', async (req, res) => {
  try {
    const Watchlist = require('./models/watchlist');
    const trending = await Watchlist.aggregate([
      { $group: { _id: "$symbol", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);
    res.json(trending);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/recent', async (req, res) => {
  try {
    const Transaction = require('./models/transaction');
    const recent = await Transaction.find().sort({ date: -1 }).limit(10);
    res.json(recent);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(port, '0.0.0.0', async () => {
  try {
    await mongoose.connect(env.mongoUri);
    console.log('✅ Connected to MongoDB');
    await setupBot();
    startDcaScheduler();
    startAlertScheduler();
    startNewsScheduler();
    startBriefingScheduler();
  } catch (error) {
    console.error('BOOT ERROR:', error.message);
  }
});
