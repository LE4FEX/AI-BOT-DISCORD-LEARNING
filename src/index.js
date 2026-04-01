const express = require('express');
const mongoose = require('mongoose');
const { setupBot } = require('./bot');
const { env } = require('./config');
const { startDcaScheduler } = require('./dca-service');
const { startAlertScheduler } = require('./alert-service');

const app = express();
const port = env.port;

app.get('/', (req, res) => res.send('AI Alpha is Live!'));

// API สำหรับ Admin Dashboard
app.get('/api/stats', async (req, res) => {
  try {
    const Watchlist = require('./models/watchlist');
    const totalUsers = await Watchlist.distinct('userId').length;
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

app.listen(port, '0.0.0.0', async () => {
  try {
    await mongoose.connect(env.mongoUri);
    await setupBot();
    startDcaScheduler();
    startAlertScheduler();
  } catch (error) {
    console.error('BOOT ERROR:', error.message);
  }
});
