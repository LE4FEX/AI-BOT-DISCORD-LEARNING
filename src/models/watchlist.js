const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    symbol: { type: String, required: true },
    amount: { type: Number, default: 0 },    // จำนวนหุ้นที่คุณถือ
    avgPrice: { type: Number, default: 0 },  // ราคาเฉลี่ยที่ซื้อมา (USD)
    addedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Watchlist', watchlistSchema);