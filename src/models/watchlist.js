const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true },
    amount: { type: Number, default: 0, min: 0 },
    avgPrice: { type: Number, default: 0, min: 0 },
    stopLoss: { type: Number, default: 0 },   // จุดตัดขาดทุน
    targetPrice: { type: Number, default: 0 }, // จุดทำกำไร
    addedAt: { type: Date, default: Date.now }
});

watchlistSchema.index({ userId: 1, symbol: 1 }, { unique: true });
module.exports = mongoose.model('Watchlist', watchlistSchema);