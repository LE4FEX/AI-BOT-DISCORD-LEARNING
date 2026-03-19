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

// Setup AI - ใช้ตัวแปรเดียวเพื่อให้ง่ายต่อการอัปเดตเวอร์ชัน
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-2.0-flash"; // หากใช้ 2.5 ได้ ให้เปลี่ยนเป็น gemini-2.5-flash

// HTTP Server for Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('AI Investment Bot is Active! 🚀'));
app.listen(port, () => console.log(`Listening on port ${port}`));

// Discord Client Setup
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.DirectMessages, 
        GatewayIntentBits.GuildMessages
    ] 
});

// ==========================================
// 🛠 UTILITY FUNCTIONS (เครื่องมือช่วยทำงาน)
// ==========================================

// 1. ฟังก์ชันแบ่งส่งข้อความ (ป้องกัน Discord 2000 char limit)
async function sendLongMessage(interaction, text) {
    const maxLength = 1900;
    if (text.length <= maxLength) {
        return interaction.deferred || interaction.replied ? await interaction.editReply(text) : await interaction.reply(text);
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

// 2. ฟังก์ชันดึงพาดหัวข่าวหุ้นรายตัว
async function getStockNews(symbol) {
    try {
        const response = await axios.get(`https://www.google.com/search?q=${symbol}+stock+news&tbm=nws`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(response.data);
        let news = [];
        $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => {
            if (i < 3) news.push($(el).text());
        });
        return news.length > 0 ? news.join(' | ') : "No recent news found";
    } catch (e) { return "News unavailable"; }
}

// 3. ฟังก์ชันดึงข่าวตลาดภาพรวม (สำหรับคำสั่ง /ask)
async function getMarketTrending() {
    try {
        const response = await axios.get(`https://www.google.com/search?q=top+trending+stocks+today+usa+market&tbm=nws`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(response.data);
        let trends = [];
        $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => {
            if (i < 5) trends.push($(el).text());
        });
        return trends.join(' | ');
    } catch (e) { return "Could not fetch trending news"; }
}

// 4. ฟังก์ชันดึงราคาหุ้นจาก Yahoo Finance
async function getStockPrice(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const result = response.data.chart.result[0].meta;
        return {
            price: result.regularMarketPrice,
            previousClose: result.previousClose,
            symbol: result.symbol
        };
    } catch (error) { throw new Error('Symbol not found'); }
}

// ==========================================
// 🚨 SCHEDULED JOBS (ระบบอัตโนมัติ)
// ==========================================

// แจ้งเตือนราคาแรง ทุก 30 นาที (จันทร์-ศุกร์)
cron.schedule('*/30 * * * 1-5', async () => {
    const allStocks = await Watchlist.find({});
    for (const item of allStocks) {
        try {
            const quote = await getStockPrice(item.symbol);
            const change = ((quote.price - quote.previousClose) / quote.previousClose * 100);

            if (Math.abs(change) >= 3) {
                const model = genAI.getGenerativeModel({ model: MODEL_NAME });
                const news = await getStockNews(item.symbol);
                const prompt = `หุ้น ${item.symbol} ขยับแรง ${change.toFixed(2)}% ราคา $${quote.price} ข่าว: ${news} วิเคราะห์สั้นๆ ว่าควร ขาย, DCA หรือ ถือ? (ภาษาไทย)`;
                
                const result = await model.generateContent(prompt);
                const user = await client.users.fetch(item.userId);
                await user.send(`📢 **Market Alert: ${item.symbol}**\n${result.response.text()}`);
            }
        } catch (e) { console.error("Cron Error:", e.message); }
    }
});

// ==========================================
// 🤖 BOT EVENTS & COMMANDS
// ==========================================

client.once('ready', async () => {
    console.log(`🤖 AI Bot Ready: ${client.user.tag}`);
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ DB Connected');
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // --- 1. ASK (ถามคำถามสดๆ กับข้อมูลตลาด) ---
    if (interaction.commandName === 'ask') {
        await interaction.deferReply();
        const question = interaction.options.getString('question');
        try {
            const marketContext = await getMarketTrending();
            const model = genAI.getGenerativeModel({ model: MODEL_NAME });

            const prompt = `คุณคือ "Expert Wall Street Analyst" ที่ตอบตรงไปตรงมาและดุดัน
            ข้อมูลตลาดวันนี้: ${marketContext}
            คำถาม: "${question}"
            คำแนะนำ: ห้ามตอบเลี่ยงบาลี ถ้าถามว่าตัวไหนน่าสนใจให้วิเคราะห์ตามข่าววันนี้และฟันธงพร้อมเหตุผล (ภาษาไทย)`;

            const result = await model.generateContent(prompt);
            await sendLongMessage(interaction, `💬 **AI Analyst Opinion:**\n\n${result.response.text()}`);
        } catch (e) { await interaction.editReply("❌ ขออภัย ระบบวิเคราะห์ขัดข้อง"); }

    // --- 2. ANALYZE PORTFOLIO ---
    } else if (interaction.commandName === 'analyze-portfolio') {
        await interaction.deferReply();
        try {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return interaction.editReply("📭 พอร์ตว่างเปล่าครับ");

            let portfolio = [];
            for (const s of stocks) {
                const q = await getStockPrice(s.symbol);
                const n = await getStockNews(s.symbol);
                portfolio.push({ symbol: s.symbol, profit: ((q.price - s.avgPrice) * s.amount).toFixed(2), news: n });
            }

            const model = genAI.getGenerativeModel({ model: MODEL_NAME });
            const prompt = `วิเคราะห์พอร์ตหุ้นนี้ตามราคาและข่าว: ${JSON.stringify(portfolio)} ตอบเป็นภาษาไทยแบบมืออาชีพ สรุป Action Plan ที่ควรทำทันที`;
            const result = await model.generateContent(prompt);
            await sendLongMessage(interaction, `🤖 **Strategic Analysis**\n\n${result.response.text()}`);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาดในการวิเคราะห์พอร์ต"); }

    // --- 3. WATCHLIST ---
    } else if (interaction.commandName === 'watchlist') {
        await interaction.deferReply();
        try {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            let results = [];
            let total = 0;
            for (const s of stocks) {
                const q = await getStockPrice(s.symbol);
                const p = (q.price - s.avgPrice) * s.amount;
                total += p;
                results.push(`${p >= 0 ? '🟢' : '🔴'} **${s.symbol}**: $${q.price.toFixed(2)} (กำไร: $${p.toFixed(2)})`);
            }
            await interaction.editReply(`📊 **Overview**\n${results.join('\n')}\n💰 **Total Profit/Loss: $${total.toFixed(2)}**`);
        } catch (e) { await interaction.editReply("❌ ไม่สามารถดึงข้อมูลพอร์ตได้"); }

    // --- 4. ADD STOCK ---
    } else if (interaction.commandName === 'add-stock') {
        await interaction.deferReply();
        const symbol = interaction.options.getString('symbol').toUpperCase();
        const amount = interaction.options.getNumber('amount');
        const avgPrice = interaction.options.getNumber('avg_price');
        try {
            let stock = await Watchlist.findOne({ userId: interaction.user.id, symbol });
            if (stock) {
                stock.avgPrice = ((stock.amount * stock.avgPrice) + (amount * avgPrice)) / (stock.amount + amount);
                stock.amount += amount;
                await stock.save();
            } else {
                await Watchlist.create({ userId: interaction.user.id, symbol, amount, avgPrice });
            }
            await interaction.editReply(`✅ บันทึกหุ้น **${symbol}** เข้าพอร์ตเรียบร้อย!`);
        } catch (e) { await interaction.editReply("❌ บันทึกข้อมูลล้มเหลว"); }
    }
});

client.login(process.env.DISCORD_TOKEN);