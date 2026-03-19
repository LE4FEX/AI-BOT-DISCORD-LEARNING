const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema({
    userId: { 
        type: String, 
        required: true,
        index: true // ช่วยให้ค้นหาพอร์ตตามรายชื่อ User ได้เร็วขึ้น
    },
    symbol: { 
        type: String, 
        required: true,
        uppercase: true, // บังคับให้เป็นตัวพิมพ์ใหญ่เสมอเพื่อป้องกันข้อมูลซ้ำซ้อน เช่น aapl vs AAPL
        trim: true 
    },
    amount: { 
        type: Number, 
        default: 0,
        min: 0 // ป้องกันจำนวนหุ้นติดลบ
    },
    avgPrice: { 
        type: Number, 
        default: 0,
        min: 0 
    },
    addedAt: { 
        type: Date, 
        default: Date.now 
    }
});

// สร้าง Compound Index เพื่อป้องกันไม่ให้ User คนเดิม เพิ่มหุ้นตัวเดิมซ้ำซ้อนใน Database
// และช่วยให้การ Update ข้อมูลทำได้รวดเร็วระดับ Millisecond
watchlistSchema.index({ userId: 1, symbol: 1 }, { unique: true });

module.exports = mongoose.model('Watchlist', watchlistSchema);