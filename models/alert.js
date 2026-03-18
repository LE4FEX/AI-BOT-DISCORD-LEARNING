const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
    userId: String,
    symbol: String,
    targetPrice: Number,
    type: { type: String, enum: ['above', 'below'] },
    active: { type: Boolean, default: true }
});

module.exports = mongoose.model('Alert', alertSchema);