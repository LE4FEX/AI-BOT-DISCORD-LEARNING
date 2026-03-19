const express = require('express');
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// Setup Express for Render Port Binding
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('AI Bot is running!'));
app.listen(port, () => console.log(`🌍 Server is listening on port ${port}`));

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Models
const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');

// รายชื่อหุ้นผู้นำตลาดสำหรับค้นหาโอกาส (Market Leaders / Trending)
const MARKET_LEADERS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'META', 'GOOGL', 'AMZN', 'NFLX', 'AMD', 'COIN', 'BTC-USD'];

// Setup AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-2.5-flash"; 

// กำหนด System Instruction พื้นฐาน
const systemInstruction = `คุณคือ 'AI Alpha' ผู้เชี่ยวชาญด้านการวิเคราะห์การลงทุนและที่ปรึกษาทางการเงินส่วนตัว
บุคลิกของคุณ: สุภาพ, เป็นกันเองแต่เป็นมืออาชีพ, มั่นใจ และให้เกียรติผู้ใช้งาน
หน้าที่ของคุณ:
1. วิเคราะห์หุ้นและตอบคำถามเกี่ยวกับการลงทุน หุ้น ตลาดทุน และเศรษฐกิจ อย่างแม่นยำและเข้าใจง่าย
2. ให้ข้อมูลเชิงลึกที่ช่วยในการตัดสินใจ โดยอ้างอิงจากข้อมูลล่าสุดและสภาวะตลาด (Fear & Greed Index)
3. ใช้โครงสร้างการตอบ: [บทสรุปและสภาวะตลาด] -> [คำแนะนำ/Action Plan] -> [ความเสี่ยง]
4. ใช้คำลงท้ายที่สุภาพ (ครับ/ค่ะ) และทักทายอย่างสั้นและกระชับที่สุดเพื่อไม่ให้บังส่วนเนื้อหาสำคัญ`;

// --- UTILITY FUNCTIONS ---

// 0. ฟังก์ชันดึง Market Sentiment (Fear & Greed)
async function getMarketSentiment() {
    try {
        const stockRes = await axios.get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const cryptoRes = await axios.get('https://api.alternative.me/fng/?limit=1');
        return {
            stock: { score: Math.round(stockRes.data.fear_and_greed.score), rating: stockRes.data.fear_and_greed.rating },
            crypto: { score: cryptoRes.data.data[0].value, rating: cryptoRes.data.data[0].value_classification }
        };
    } catch (e) { return null; }
}

// 0.1 ฟังก์ชันดึงข้อมูลบริษัท (Sector/Industry)
async function getStockProfile(symbol) {
    try {
        const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile`;
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        return res.data.quoteSummary.result[0].assetProfile;
    } catch (e) { return null; }
}

// 0.2 ฟังก์ชันดึงวันประกาศงบ (Earnings Date)
async function getUpcomingEarnings(symbol) {
    try {
        const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=calendarEvents`;
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const events = res.data.quoteSummary.result[0].calendarEvents;
        return events && events.earnings ? events.earnings.earningsDate[0].fmt : null;
    } catch (e) { return null; }
}

// 1. ฟังก์ชันเรียกใช้ AI แบบกำหนดสไตล์ (Global)
async function getAIAnalysis(prompt, specializedInstruction = null) {
    try {
        const sentiment = await getMarketSentiment();
        const sentimentContext = sentiment ? `\nMarket Sentiment Today: Stock Index is ${sentiment.stock.score} (${sentiment.stock.rating}), Crypto Index is ${sentiment.crypto.score} (${sentiment.crypto.rating})` : "";
        
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME,
            systemInstruction: (specializedInstruction || systemInstruction) + sentimentContext
        });
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) {
        console.error("AI Error:", e);
        return "⚠️ AI ไม่สามารถวิเคราะห์ได้ในขณะนี้";
    }
}

// 2. ฟังก์ชันส่ง Embed แบบจัดการข้อความยาว
async function sendEmbedResponse(interaction, title, description, color = 0x0099FF) {
    const maxLength = 4000; // Discord Embed Description limit is 4096

    if (description.length <= maxLength) {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
    }

    // กรณีข้อความยาวเกิน limit ของ Embed
    const chunks = [];
    for (let i = 0; i < description.length; i += maxLength) {
        chunks.push(description.substring(i, i + maxLength));
    }

    const firstEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(chunks[0])
        .setColor(color);

    await interaction.editReply({ embeds: [firstEmbed] });

    for (let i = 1; i < chunks.length; i++) {
        const nextEmbed = new EmbedBuilder()
            .setDescription(chunks[i])
            .setColor(color);
        await interaction.followUp({ embeds: [nextEmbed] });
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
        try {
            const user = await client.users.fetch(id);
            await user.send(`🌟 **Daily Market Pulse**\n\n${insight}`);
        } catch (e) { console.error(`Failed to send pulse to ${id}:`, e.message); }
    }
});

// Earnings Call Reminder (08:00 น. ทุกวันจันทร์-ศุกร์)
cron.schedule('0 8 * * 1-5', async () => {
    const symbols = await Watchlist.distinct('symbol');
    for (const symbol of symbols) {
        try {
            const earningsDate = await getUpcomingEarnings(symbol);
            if (!earningsDate) continue;
            
            const today = new Date();
            const eDate = new Date(earningsDate);
            const diffDays = Math.ceil((eDate - today) / (1000 * 60 * 60 * 24));
            
            if (diffDays >= 0 && diffDays <= 7) {
                const userIds = await Watchlist.find({ symbol }).distinct('userId');
                for (const userId of userIds) {
                    try {
                        const user = await client.users.fetch(userId);
                        await user.send(`📅 **Earnings Reminder: ${symbol}**\nบริษัทจะประกาศผลประกอบการในวันที่ **${earningsDate}** (${diffDays === 0 ? 'วันนี้!' : 'อีก ' + diffDays + ' วัน'})\nอย่าลืมติดตามนะครับ!`);
                    } catch (e) { console.error(e.message); }
                }
            }
        } catch (e) { console.error(e.message); }
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
        await sendEmbedResponse(interaction, "🤖 AI Strategic Analysis", analysis, 0x00FF00);

    // 2. ASK (สุภาพและข้อมูลสด)
    } else if (interaction.commandName === 'ask') {
        await interaction.deferReply();
        const question = interaction.options.getString('question');
        const market = await getMarketTrending();
        const analystInstruction = `คุณคือ 'Senior Wealth Advisor' ที่ให้คำแนะนำอย่างรอบคอบและสุภาพ ข้อมูลตลาดวันนี้: ${market} กรุณาตอบคำถามโดยเน้นความถูกต้องและให้มุมมองที่รอบด้านเพื่อประโยชน์สูงสุดของผู้ลงทุน และทักทายอย่างสั้นที่สุด`;
        const analysis = await getAIAnalysis(`คำถามนักลงทุน: "${question}" ช่วยวิเคราะห์และให้คำตอบตามข้อมูลล่าสุด`, analystInstruction);
        await sendEmbedResponse(interaction, `💬 Investor Q&A: ${question.substring(0, 100)}`, analysis);

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
        const description = `📊 **Overview**\n${res.join('\n')}\n\n💰 **Total P/L: $${total.toFixed(2)}**`;
        await sendEmbedResponse(interaction, "My Watchlist", description, 0xFFA500);

    // 4. STOCK (รายตัว)
    } else if (interaction.commandName === 'stock') {
        await interaction.deferReply();
        const sym = interaction.options.getString('symbol').toUpperCase();
        try {
            const q = await getStockPrice(sym);
            const n = await getStockNews(sym);
            const analysis = await getAIAnalysis(`หุ้น ${sym} ราคา $${q.price} ข่าว: ${n} วิเคราะห์ความน่าสนใจสั้นๆ`);
            await sendEmbedResponse(interaction, `📈 Stock Analysis: ${sym}`, `**Current Price:** $${q.price.toFixed(2)}\n\n${analysis}`);
        } catch (e) { await interaction.editReply("❌ ไม่พบข้อมูลหุ้น"); }

    // 5. DISCOVER
    } else if (interaction.commandName === 'discover') {
        await interaction.deferReply();
        const market = await getMarketTrending();
        const analysis = await getAIAnalysis(`จากข่าวตลาดวันนี้: ${market} แนะนำหุ้นที่น่าจับตาที่สุด 2 ตัวพร้อมเหตุผลเชิงกลยุทธ์`);
        await sendEmbedResponse(interaction, "🔎 AI Discovery", analysis, 0x9B59B6);

    // 5.1 SENTIMENT
    } else if (interaction.commandName === 'sentiment') {
        await interaction.deferReply();
        const sentiment = await getMarketSentiment();
        if (!sentiment) return await interaction.editReply("❌ ไม่สามารถดึงข้อมูลสภาวะตลาดได้ในขณะนี้");
        const analysis = await getAIAnalysis(`สภาวะตลาดปัจจุบัน: หุ้น ${sentiment.stock.score} (${sentiment.stock.rating}), คริปโต ${sentiment.crypto.score} (${sentiment.crypto.rating}) ช่วยอธิบายว่าสภาวะนี้ควรลงทุนอย่างไร`);
        const description = `📊 **Stock Fear & Greed:** ${sentiment.stock.score} (${sentiment.stock.rating})\n🪙 **Crypto Fear & Greed:** ${sentiment.crypto.score} (${sentiment.crypto.rating})\n\n💡 **AI Advice:** ${analysis}`;
        await sendEmbedResponse(interaction, "🌍 Global Market Sentiment", description, 0xFFFF00);

    // 5.2 ANALYZE DIVERSIFICATION
    } else if (interaction.commandName === 'analyze-diversification') {
        await interaction.deferReply();
        const stocks = await Watchlist.find({ userId: interaction.user.id });
        if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");
        
        let sectorAllocation = {};
        let totalValue = 0;
        
        for (const s of stocks) {
            try {
                const q = await getStockPrice(s.symbol);
                const profile = await getStockProfile(s.symbol);
                const sector = profile ? profile.sector : "Unknown";
                const value = q.price * s.amount;
                
                sectorAllocation[sector] = (sectorAllocation[sector] || 0) + value;
                totalValue += value;
            } catch (e) { continue; }
        }
        
        let allocationText = [];
        for (const sector in sectorAllocation) {
            const percent = (sectorAllocation[sector] / totalValue * 100).toFixed(2);
            allocationText.push(`- **${sector}:** ${percent}%`);
        }
        
        const analysis = await getAIAnalysis(`วิเคราะห์การกระจายความเสี่ยง: พอร์ตมีการถือครองตามกลุ่มดังนี้ ${JSON.stringify(sectorAllocation)} (สัดส่วนร้อยละ: ${allocationText.join(', ')}) ช่วยวิเคราะห์ว่ากระจายความเสี่ยงดีหรือยัง และควรปรับปรุงอย่างไร`);
        const description = `📈 **Current Allocation:**\n${allocationText.join('\n')}\n\n🕵️ **AI Risk Analysis:**\n${analysis}`;
        await sendEmbedResponse(interaction, "🧩 Portfolio Diversification Review", description, 0x3498DB);

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

client.login(process.env.DISCORD_TOKEN);