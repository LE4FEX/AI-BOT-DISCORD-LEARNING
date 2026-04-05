const mongoose = require('mongoose');

const goalSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true }, // เช่น "รถในฝัน", "อิสรภาพทางการเงิน"
    targetAmount: { type: Number, required: true }, // ยอดเงินเป้าหมาย (USD)
    currentAmount: { type: Number, default: 0 },
    deadline: { type: Date },
    category: { type: String, enum: ['Car', 'Retirement', 'Travel', 'Other'], default: 'Other' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Goal', goalSchema);
