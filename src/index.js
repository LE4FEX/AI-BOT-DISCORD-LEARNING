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

// รายชื่อหุ้นผู้นำตลาดสำหรับค้นหาโอกาส (Market Leaders / Trending)
const MARKET_LEADERS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'META', 'GOOGL', 'AMZN', 'NFLX', 'AMD', 'COIN', 'BTC-USD'];

// Setup AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-2.5-flash"; 

// กำหนด System Instruction พื้นฐาน
const systemInstruction = `คุณคือ 'AI Alpha' นักวิเคราะห์การลงทุนมืออาชีพ
หน้าที่ของคุณ:
1. วิเคราะห์หุ้นและตอบคำถามเกี่ยวกับการลงทุน หุ้น ตลาดทุน และเศรษฐกิจ อย่างแม่นยำและกระชับ
2. สำหรับการวิเคราะห์พอร์ตหรือหุ้นรายตัว ให้ใช้โครงสร้าง: [สรุปสภาวะ] -> [Action Plan] -> [ความเสี่ยง]
3. ตัดคำทักทายและคำฟุ่มเฟือยออกทั้งหมด ตอบเป็นภาษาไทยที่คมชัดและเป็นมืออาชีพ`;

// --- UTILITY FUNCTIONS ---

// 1. ฟังก์ชันเรียกใช้ AI แบบกำหนดสไตล์ (Global)
async function getAIAnalysis(prompt, specializedInstruction = null) {
    try {
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME,
            systemInstruction: specializedInstruction || systemInstruction
        });
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) {
        console.error("AI Error:", e);
        return "⚠️ AI ไม่สามารถวิเคราะห์ได้ในขณะนี้";
    }
}

// 2. ฟังก์ชันส่งข้อความยาวๆ โดยการแบ่งเป็นส่วนๆ (ป้องกัน Limit 2000 ตัวอักษร)
async function sendLongMessage(interaction, text) {
    const maxLength = 1900;
    if (text.length <= maxLength) {
        return await interaction.editReply(text);
    }
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLength) {
        chunks.push(text.substring(i, i + maxLength));
    }
    await interaction.editReply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
    }
}

// 3. ฟังก์ชันดึงข่าวพาดหัวจาก Google News
async function getStockNews(symbol) {
    try {
        const response = await axios.get(`https://www.google.com/search?q=${symbol}+stock+news&tbm=nws`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(response.data);
        let news = [];
        $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => { if (i < 3) news.push($(el).text()); });
        return news.length > 0 ? news.join(' | ') : "No recent news found";
    } catch (e) { return "News unavailable"; }
}

// 4. ฟังก์ชันดึงข่าวตลาดรวมวันนี้ (สำหรับ /ask)
async function getMarketTrending() {
    try {
        const response = await axios.get(`https://www.google.com/search?q=top+trending+stocks+today+usa+market&tbm=nws`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(response.data);
        let trends = [];
        $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => { if (i < 5) trends.push($(el).text()); });
        return trends.join(' | ');
    } catch (e) { return "Unable to fetch global trends"; }
}

// 5. ฟังก์ชันดึงราคาหุ้น
async function getStockPrice(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const result = response.data.chart.result[0].meta;
        return { price: result.regularMarketPrice, previousClose: result.previousClose, symbol: result.symbol };
    } catch (error) { throw error; }
}

// --- SCHEDULED JOBS ---

// แจ้งเตือนราคาขยับแรง ทุก 30 นาที
cron.schedule('*/30 * * * 1-5', async () => {
    const allStocks = await Watchlist.find({});
    for (const item of allStocks) {
        try {
            const quote = await getStockPrice(item.symbol);
            const change = ((quote.price - quote.previousClose) / quote.previousClose * 100);
            if (Math.abs(change) >= 3) {
                const news = await getStockNews(item.symbol);
                const analysis = await getAIAnalysis(`วิเคราะห์ด่วน: ${item.symbol} ขยับแรง ${change.toFixed(2)}% ข่าว: ${news} สรุป Action Plan สั้นๆ`);
                const user = await client.users.fetch(item.userId);
                await user.send(`📢 **AI Alert: ${item.symbol}**\n${analysis}`);
            }
        } catch (e) { console.error(e.message); }
    }
});

// Daily Market Pulse (21:30 น.)
cron.schedule('30 21 * * 1-5', async () => {
    let trends = [];
    for (const s of MARKET_LEADERS.slice(0, 5)) {
        try {
            const q = await getStockPrice(s);
            trends.push({ symbol: s, change: ((q.price - q.previousClose) / q.previousClose * 100) });
        } catch (e) { continue; }
    }
    const insight = await getAIAnalysis(`หุ้นเด่นคืนนี้: ${JSON.stringify(trends.sort((a,b)=>b.change-a.change))} แนะนำตัวที่น่าสนใจสุด 1 ตัว`);
    const userIds = await Watchlist.distinct('userId');
    for (const id of userIds) {
        const user = await client.users.fetch(id);
        await user.send(`🌟 **Daily Market Pulse**\n\n${insight}`);
    }
});

// --- BOT EVENTS ---

client.once('ready', async () => {
    console.log(`🤖 AI Bot Ready: ${client.user.tag}`);
    await mongoose.connect(process.env.MONGODB_URI);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // 1. ANALYZE PORTFOLIO
    if (interaction.commandName === 'analyze-portfolio') {
        await interaction.deferReply();
        const stocks = await Watchlist.find({ userId: interaction.user.id });
        if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");
        let portfolio = [];
        for (const s of stocks) {
            const q = await getStockPrice(s.symbol);
            const n = await getStockNews(s.symbol);
            portfolio.push({ symbol: s.symbol, profit: (q.price - s.avgPrice).toFixed(2), news: n });
        }
        const analysis = await getAIAnalysis(`วิเคราะห์พอร์ต: ${JSON.stringify(portfolio)} เน้นสภาวะตลาดและ Action Plan`);
        await sendLongMessage(interaction, `🤖 **AI Strategic Analysis**\n\n${analysis}`);

    // 2. ASK (แบบดุดันและข้อมูลสด)
    } else if (interaction.commandName === 'ask') {
        await interaction.deferReply();
        const question = interaction.options.getString('question');
        const market = await getMarketTrending();
        const analystInstruction = `คุณคือ 'Expert Wall Street Analyst' ที่ตอบคำถามตรงไปตรงมา ดุดัน และไม่เกรงใจใคร ห้ามตอบเลี่ยงบาลี ข้อมูลวันนี้: ${market}`;
        const analysis = await getAIAnalysis(`คำถามนักลงทุน: "${question}" ตอบให้ชัดเจน ฟันธงตามข้อมูล`, analystInstruction);
        await sendLongMessage(interaction, `💬 **Investor Q&A**\n**Q:** ${question}\n\n${analysis}`);

    // 3. WATCHLIST
    } else if (interaction.commandName === 'watchlist') {
        await interaction.deferReply();
        const stocks = await Watchlist.find({ userId: interaction.user.id });
        let res = []; let total = 0;
        for (const s of stocks) {
            const q = await getStockPrice(s.symbol);
            const p = (q.price - s.avgPrice) * s.amount; total += p;
            res.push(`${p >= 0 ? '🟢' : '🔴'} **${s.symbol}**: $${q.price.toFixed(2)} (กำไร: $${p.toFixed(2)})`);
        }
        await interaction.editReply(`📊 **Overview**\n${res.join('\n')}\n💰 **Total P/L: $${total.toFixed(2)}**`);

    // 4. STOCK (รายตัว)
    } else if (interaction.commandName === 'stock') {
        await interaction.deferReply();
        const sym = interaction.options.getString('symbol').toUpperCase();
        try {
            const q = await getStockPrice(sym);
            const n = await getStockNews(sym);
            const analysis = await getAIAnalysis(`หุ้น ${sym} ราคา $${q.price} ข่าว: ${n} วิเคราะห์ความน่าสนใจสั้นๆ`);
            await interaction.editReply(`📈 **${sym}**: $${q.price.toFixed(2)}\n📰 AI วิเคราะห์: ${analysis}`);
        } catch (e) { await interaction.editReply("❌ ไม่พบข้อมูลหุ้น"); }

    // 5. DISCOVER
    } else if (interaction.commandName === 'discover') {
        await interaction.deferReply();
        const market = await getMarketTrending();
        const analysis = await getAIAnalysis(`จากข่าวตลาดวันนี้: ${market} แนะนำหุ้นที่น่าจับตาที่สุด 2 ตัวพร้อมเหตุผลเชิงกลยุทธ์`);
        await sendLongMessage(interaction, `🔎 **AI Discovery**\n\n${analysis}`);

    // 6. ADD / REMOVE / UPDATE / HISTORY
    } else if (interaction.commandName === 'add-stock') {
        await interaction.deferReply();
        const s = interaction.options.getString('symbol').toUpperCase();
        const a = interaction.options.getNumber('amount');
        const p = interaction.options.getNumber('avg_price');
        let stock = await Watchlist.findOne({ userId: interaction.user.id, symbol: s });
        if (stock) {
            stock.avgPrice = ((stock.amount * stock.avgPrice) + (a * p)) / (stock.amount + a);
            stock.amount += a; await stock.save();
        } else {
            await Watchlist.create({ userId: interaction.user.id, symbol: s, amount: a, avgPrice: p });
        }
        await Transaction.create({ userId: interaction.user.id, symbol: s, type: 'BUY', amount: a, price: p });
        await interaction.editReply(`✅ บันทึกหุ้น **${s}** เรียบร้อย!`);

    } else if (interaction.commandName === 'remove-stock') {
        await interaction.deferReply();
        const s = interaction.options.getString('symbol').toUpperCase();
        await Watchlist.deleteOne({ userId: interaction.user.id, symbol: s });
        await interaction.editReply(`✅ ลบหุ้น **${s}** ออกแล้ว`);

    } else if (interaction.commandName === 'history') {
        await interaction.deferReply();
        const logs = await Transaction.find({ userId: interaction.user.id }).sort({ date: -1 }).limit(10);
        const text = logs.map(l => `🔹 **${l.type}** ${l.symbol} | ${l.amount} หุ้น | $${l.price}`).join('\n');
        await interaction.editReply(`📜 **ประวัติล่าสุด**\n${text || 'ไม่พบรายการ'}`);
    }
});

const app = express(); app.get('/', (req, res) => res.send('OK')); app.listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);