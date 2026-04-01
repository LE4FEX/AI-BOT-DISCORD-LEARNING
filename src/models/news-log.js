const mongoose = require('mongoose');

const newsLogSchema = new mongoose.Schema({
    symbol: { type: String, required: true, index: true },
    titleHash: { type: String, required: true, unique: true }, // ใช้เก็บ Hash ของหัวข้อข่าวเพื่อกันซ้ำ
    date: { type: Date, default: Date.now, expires: '7d' } // ข้อมูลจะถูกลบอัตโนมัติใน 7 วัน
});

module.exports = mongoose.models.NewsLog || mongoose.model('NewsLog', newsLogSchema);