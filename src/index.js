const express = require('express');
const mongoose = require('mongoose');
const { setupBot } = require('./bot');
const { env } = require('./config');
const { startDcaScheduler } = require('./dca-service');
const { startAlertScheduler } = require('./alert-service');
const { startNewsScheduler } = require('./news-service');
const path = require('path');

const app = express();
const port = env.port;

// เปิดใช้งานการส่งไฟล์ Static (สำหรับ Dashboard)
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// API สำหรับ Admin Dashboard
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
    await setupBot();
    startDcaScheduler();
    startAlertScheduler();
    startNewsScheduler();
  } catch (error) {
    console.error('BOOT ERROR:', error.message);
  }
});
