const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    userId: { 
        type: String, 
        required: true,
        index: true 
    },
    symbol: { 
        type: String, 
        required: true,
        uppercase: true,
        trim: true 
    },
    type: { 
        type: String, 
        enum: ['BUY', 'SELL', 'UPDATE'], // จำกัดประเภทข้อมูลเพื่อความแม่นยำ
        required: true 
    },
    amount: { 
        type: Number, 
        required: true 
    },
    price: { 
        type: Number, 
        required: true 
    },
    date: { 
        type: Date, 
        default: Date.now 
    }
});

// สร้าง Index สำหรับการเรียกดูประวัติ โดยเรียงจากวันที่ล่าสุด (Descending)
// ทำให้คำสั่ง /history ทำงานได้รวดเร็วแม้จะมีประวัติเป็นพันรายการ
transactionSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);