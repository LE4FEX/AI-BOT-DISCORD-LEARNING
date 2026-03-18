const express = require('express');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cron = require('node-cron');

// Models
const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');

// Setup AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// HTTP Server for Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('AI Investment Bot is Active! 🚀'));
app.listen(port, () => console.log(`Listening on port ${port}`));

// Discord Client
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.DirectMessages, 
        GatewayIntentBits.GuildMessages
    ] 
});

// ฟังก์ชันดึงราคาหุ้น
async function getStockPrice(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        const data = await response.json();
        const result = data.chart.result[0].meta;
        return {
            price: result.regularMarketPrice,
            currency: result.currency,
            symbol: result.symbol,
            previousClose: result.previousClose
        };
    } catch (error) { throw error; }
}

// ==========================================
// 🚨 ระบบเฝ้าระวังตลาดและแจ้งเตือน AI อัตโนมัติ 🚨
// ทำงานทุก 30 นาที (จันทร์-ศุกร์ ช่วงตลาดเปิด)
// ==========================================
cron.schedule('*/30 * * * 1-5', async () => {
    console.log("🔍 AI กำลังตรวจสอบความเคลื่อนไหวของตลาด...");
    const allStocks = await Watchlist.find({});
    
    for (const item of allStocks) {
        try {
            const quote = await getStockPrice(item.symbol);
            const change = ((quote.price - quote.previousClose) / quote.previousClose * 100);

            // แจ้งเตือนเมื่อราคาขยับแรง (> 3%) หรือถึงจุดที่ AI ควรวิเคราะห์
            if (Math.abs(change) >= 3) {
                const prompt = `หุ้น ${item.symbol} ขยับแรง ${change.toFixed(2)}% ราคาปัจจุบัน $${quote.price}
                ในพอร์ตถืออยู่ ${item.amount} หุ้น ทุน $${item.avgPrice}
                ช่วยวิเคราะห์เชิงลึก: จังหวะนี้ควร "ขายทำกำไร", "DCA เพิ่ม", หรือ "ถือเฉยๆ"? ตอบเป็นภาษาไทยสั้นๆ กระชับ`;
                
                const result = await model.generateContent(prompt);
                const user = await client.users.fetch(item.userId);
                await user.send(`📢 **AI Market Alert: ${item.symbol}**\n${result.response.text()}`);
            }
        } catch (e) { console.error(e); }
    }
});

// ==========================================
// 📅 ระบบสรุปพอร์ตรายสัปดาห์ (ทุกวันเสาร์ 10:00 น.)
// ==========================================
cron.schedule('0 10 * * 6', async () => {
    const users = await Watchlist.distinct('userId');
    for (const userId of users) {
        try {
            const stocks = await Watchlist.find({ userId });
            let data = [];
            for (const s of stocks) {
                const q = await getStockPrice(s.symbol);
                data.push({ symbol: s.symbol, cost: s.avgPrice, current: q.price, amount: s.amount });
            }

            const prompt = `วิเคราะห์พอร์ตนี้อย่างละเอียด (Efficiency Insights): ${JSON.stringify(data)}
            1. ความหลากหลาย (Diversification) 
            2. ตัวไหนควร Rebalance (โยกเงิน) 
            3. กลยุทธ์สัปดาห์หน้า (DCA ตัวไหนดี)`;
            
            const result = await model.generateContent(prompt);
            const user = await client.users.fetch(userId);
            await user.send(`🗞️ **Weekly AI Strategic Report**\n\n${result.response.text()}`);
        } catch (e) { console.error(e); }
    }
});

client.once('ready', () => {
    console.log(`🤖 AI Bot Ready: ${client.user.tag}`);
    mongoose.connect(process.env.MONGODB_URI).then(() => console.log('✅ DB Connected'));
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // --- ANALYZE PORTFOLIO (Manual) ---
    if (interaction.commandName === 'analyze-portfolio') {
        await interaction.deferReply();
        try {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            let portfolio = [];
            for (const s of stocks) {
                const q = await getStockPrice(s.symbol);
                portfolio.push({ 
                    symbol: s.symbol, cost: s.avgPrice, current: q.price, 
                    profit: ((q.price - s.avgPrice) * s.amount).toFixed(2)
                });
            }

            const prompt = `วิเคราะห์เชิงลึกหุ้นรายตัวในพอร์ตนี้ และแนะนำจุดเข้าซื้อ/ขาย/DCA ที่ดีที่สุด: ${JSON.stringify(portfolio)} ตอบภาษาไทย`;
            const result = await model.generateContent(prompt);
            await interaction.editReply(`🤖 **AI Strategic Analysis**\n\n${result.response.text().substring(0, 1900)}`);
        } catch (e) {
                        console.error("AI Error Detail:", e); // ดู Error จริงใน Terminal
                        await interaction.editReply('❌ AI ขัดข้อง: อาจเกิดจาก Quota เต็ม หรือ Key ไม่ถูกต้องครับ');
                    }

    // --- WATCHLIST (Check Status) ---
    } else if (interaction.commandName === 'watchlist') {
        await interaction.deferReply();
        const stocks = await Watchlist.find({ userId: interaction.user.id });
        let results = [];
        let total = 0;
        for (const s of stocks) {
            const q = await getStockPrice(s.symbol);
            const p = (q.price - s.avgPrice) * s.amount;
            total += p;
            results.push(`${p >= 0 ? '🟢' : '🔴'} **${s.symbol}**: $${q.price} (ทุน $${s.avgPrice})\n   └ กำไร: $${p.toFixed(2)} (${s.amount} หุ้น)`);
        }
        await interaction.editReply(`📊 **Portfolio Overview**\n${results.join('\n')}\n\n💰 **รวม: $${total.toFixed(2)}**`);

    // --- ADD-STOCK (DCA System) ---
    } else if (interaction.commandName === 'add-stock') {
        await interaction.deferReply();
        const symbol = interaction.options.getString('symbol').toUpperCase();
        const amount = interaction.options.getNumber('amount');
        const avgPrice = interaction.options.getNumber('avg_price');
        
        let stock = await Watchlist.findOne({ userId: interaction.user.id, symbol });
        if (stock) {
            const newPrice = ((stock.amount * stock.avgPrice) + (amount * avgPrice)) / (stock.amount + amount);
            stock.amount += amount; stock.avgPrice = newPrice;
            await stock.save();
        } else {
            await Watchlist.create({ userId: interaction.user.id, symbol, amount, avgPrice });
        }
        await Transaction.create({ userId: interaction.user.id, symbol, type: 'BUY', amount, price: avgPrice });
        await interaction.editReply(`✅ บันทึกการเพิ่มหุ้น **${symbol}** เรียบร้อย!`);
    }
});

client.login(process.env.DISCORD_TOKEN);