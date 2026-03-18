const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    symbol: { type: String, required: true },
    type: { type: String, enum: ['BUY', 'SELL', 'UPDATE'], required: true },
    amount: { type: Number, required: true },
    price: { type: Number, required: true },
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);