const express = require('express');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');

// Models
const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');

// Setup AI - สร้าง Instance ไว้สำหรับดึง Model ในภายหลัง
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

// ฟังก์ชันดึงพาดหัวข่าวล่าสุดจาก Google News
async function getStockNews(symbol) {
    try {
        const response = await axios.get(`https://www.google.com/search?q=${symbol}+stock+news&tbm=nws`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(response.data);
        let news = [];
        $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => {
            if (i < 3) news.push($(el).text()); // เอาแค่ 3 ข่าวล่าสุด
        });
        return news.join(' | ');
    } catch (e) {
        return "No recent news found";
    }
}

// ฟังก์ชันดึงราคาหุ้น
async function getStockPrice(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        const data = await response.json();
        if (!data.chart || !data.chart.result) throw new Error('Symbol Not Found');
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
// 🚨 ระบบเฝ้าระวังตลาดและแจ้งเตือน AI อัตโนมัติ (Efficiency Insights)
// ==========================================
cron.schedule('*/30 * * * 1-5', async () => {
    console.log("🔍 AI กำลังตรวจสอบความเคลื่อนไหวของตลาด...");
    const allStocks = await Watchlist.find({});
    
    for (const item of allStocks) {
        try {
            const quote = await getStockPrice(item.symbol);
            const change = ((quote.price - quote.previousClose) / quote.previousClose * 100);

            if (Math.abs(change) >= 3) {
                // อัปเดตเป็น 2.5-flash เพื่อแก้ 404
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const news = await getStockNews(item.symbol); // ดึงข่าวมาประกอบด้วยเลย
                
                const prompt = `หุ้น ${item.symbol} ขยับแรง ${change.toFixed(2)}% ราคา $${quote.price} (ทุน $${item.avgPrice})
                ข่าวล่าสุด: ${news}
                วิเคราะห์เชิงลึก: จังหวะนี้ควร "ขายทำกำไร", "DCA เพิ่ม", หรือ "ถือ" เพราะอะไร? (วิเคราะห์จากราคาและข่าว ตอบภาษาไทยสั้นๆ)`;
                
                const result = await model.generateContent(prompt);
                const user = await client.users.fetch(item.userId);
                await user.send(`📢 **AI Market Alert: ${item.symbol}**\n${result.response.text()}`);
            }
        } catch (e) { console.error("Cron Monitor Error:", e.message); }
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

            // อัปเดตเป็น 2.5-flash
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const prompt = `วิเคราะห์พอร์ตรายสัปดาห์ (Efficiency Insights): ${JSON.stringify(data)}
            1. ความเสี่ยงการกระจุกตัว (Diversification)
            2. แนะนำการ Rebalance (โยกเงิน)
            3. กลยุทธ์เข้าซื้อ/ขายในสัปดาห์หน้าเพื่อให้พอร์ตโตดีที่สุด`;
            
            const result = await model.generateContent(prompt);
            const user = await client.users.fetch(userId);
            await user.send(`🗞️ **Weekly AI Strategic Report**\n\n${result.response.text()}`);
        } catch (e) { console.error("Weekly Report Error:", e.message); }
    }
});

client.once('ready', async () => {
    console.log(`🤖 AI Bot Ready: ${client.user.tag}`);
    
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ DB Connected');
    } catch (err) {
        console.error('❌ DB Connection Error:', err);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // --- ANALYZE PORTFOLIO (วิเคราะห์เชิงลึกรายตัว + ข่าวต่างประเทศ) ---
    if (interaction.commandName === 'analyze-portfolio') {
        await interaction.deferReply();
        try {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");

            let portfolio = [];
            for (const s of stocks) {
                const q = await getStockPrice(s.symbol);
                const news = await getStockNews(s.symbol); // 🚀 ระบบดึงข่าวทำงานตรงนี้
                
                portfolio.push({ 
                    symbol: s.symbol, cost: s.avgPrice, current: q.price, 
                    profit: ((q.price - s.avgPrice) * s.amount).toFixed(2),
                    amount: s.amount,
                    latestNews: news // 🚀 แนบข่าวเข้าไปในข้อมูลพอร์ต
                });
            }

            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            
            const prompt = `ในฐานะผู้เชี่ยวชาญด้านหุ้นต่างประเทศ ช่วยวิเคราะห์พอร์ตนี้โดยพิจารณาจาก "ราคา" และ "ข่าวล่าสุด (latestNews)":
            ${JSON.stringify(portfolio)}
            
            รูปแบบการตอบ:
            1. สรุปภาพรวมตลาดตามข่าวปัจจุบัน (Global Sentiment)
            2. วิเคราะห์หุ้นรายตัวในพอร์ตว่าข่าวล่าสุดส่งผลดีหรือเสียอย่างไร
            3. แนะนำกลยุทธ์ (Actionable Plan) ตามกระแสข่าว ควรซื้อเพิ่มหรือขายทำกำไร
            ตอบเป็นภาษาไทยแบบมืออาชีพ อ่านง่าย และชัดเจน`;
            
            const result = await model.generateContent(prompt);
            await interaction.editReply(`🤖 **AI Global News & Strategic Analysis**\n\n${result.response.text().substring(0, 1900)}`);
        } catch (e) { 
            console.error("AI Error:", e);
            await interaction.editReply('❌ ระบบวิเคราะห์ขัดข้อง กรุณาลองใหม่อีกครั้ง');
        }

    // --- WATCHLIST (ดูสถานะปัจจุบัน) ---
    } else if (interaction.commandName === 'watchlist') {
        await interaction.deferReply();
        try {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");

            let results = [];
            let totalProfit = 0;
            for (const s of stocks) {
                const q = await getStockPrice(s.symbol);
                const p = (q.price - s.avgPrice) * s.amount;
                totalProfit += p;
                results.push(`${p >= 0 ? '🟢' : '🔴'} **${s.symbol}**: $${q.price.toFixed(2)} (ทุน $${s.avgPrice.toFixed(2)})\n   └ กำไร: $${p.toFixed(2)} (${s.amount} หุ้น)`);
            }
            await interaction.editReply(`📊 **Portfolio Overview**\n${results.join('\n')}\n\n💰 **รวมกำไร/ขาดทุนทั้งหมด: $${totalProfit.toFixed(2)}**`);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาดในการดึงข้อมูล"); }

    // --- ADD-STOCK (บันทึก DCA) ---
    } else if (interaction.commandName === 'add-stock') {
        await interaction.deferReply();
        const symbol = interaction.options.getString('symbol').toUpperCase();
        const amount = interaction.options.getNumber('amount');
        const avgPrice = interaction.options.getNumber('avg_price');
        
        try {
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
        } catch (e) { await interaction.editReply("❌ บันทึกข้อมูลไม่สำเร็จ"); }
    }
});

client.login(process.env.DISCORD_TOKEN);