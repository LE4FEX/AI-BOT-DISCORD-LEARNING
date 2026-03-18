const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    symbols: { type: [String], default: [] }
});

module.exports = mongoose.model('Watchlist', watchlistSchema);