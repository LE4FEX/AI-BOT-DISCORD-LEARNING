const mongoose = require('mongoose');

const newsLogSchema = new mongoose.Schema({
    symbol: { type: String, required: true, index: true },
    title: { type: String, required: true },
    titleHash: { type: String, required: true, unique: true },
    embedding: { type: [Number], index: '2dsphere' }, // เก็บ Vector (ใช้ index '2dsphere' เป็นตัวแทนเบื้องต้นใน Schema)
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.models.NewsLog || mongoose.model('NewsLog', newsLogSchema);