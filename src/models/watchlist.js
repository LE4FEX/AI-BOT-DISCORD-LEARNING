const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    symbol: { type: String, required: true },
    addedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Watchlist', watchlistSchema);