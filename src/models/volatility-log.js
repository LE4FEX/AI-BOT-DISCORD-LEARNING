const mongoose = require('mongoose');

const volatilityLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    symbol: { type: String, required: true },
    date: { type: String, required: true }, // เก็บเป็น YYYY-MM-DD
    lastTriggeredPercent: { type: Number, required: true }
});

// ข้อมูลจะหายไปเองใน 24 ชั่วโมง
volatilityLogSchema.index({ date: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.models.VolatilityLog || mongoose.model('VolatilityLog', volatilityLogSchema);