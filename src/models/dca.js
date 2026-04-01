const mongoose = require('mongoose');

const dcaSchema = new mongoose.Schema({
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
    amount: { 
        type: Number, // จำนวนเงินที่ต้องการลงทุนแต่ละครั้ง (USD)
        required: true 
    },
    frequency: { 
        type: String, 
        enum: ['DAILY', 'WEEKLY', 'MONTHLY'], 
        required: true 
    },
    nextExecution: { 
        type: Date, 
        required: true,
        index: true
    },
    lastExecution: { 
        type: Date 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.models.Dca || mongoose.model('Dca', dcaSchema);