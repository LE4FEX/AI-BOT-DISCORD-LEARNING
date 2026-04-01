const mongoose = require('mongoose');

const snapshotSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    date: { type: Date, default: Date.now, index: true },
    totalValue: Number,
    totalCost: Number,
    profit: Number,
    profitPercent: Number
});

module.exports = mongoose.models.Snapshot || mongoose.model('Snapshot', snapshotSchema);