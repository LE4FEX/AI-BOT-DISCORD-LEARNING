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

const MARKET_LEADERS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'META', 'GOOGL', 'AMZN', 'NFLX', 'AMD', 'COIN', 'BTC-USD'];

// Setup AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-2.5-flash"; 

const systemInstruction = `คุณคือ 'AI Alpha' ผู้เชี่ยวชาญด้านการวิเคราะห์การลงทุนและที่ปรึกษาทางการเงินส่วนตัว
บุคลิกของคุณ: สุภาพ, เป็นกันเองแต่เป็นมืออาชีพ, มั่นใจ และให้เกียรติผู้ใช้งาน
หน้าที่ของคุณ:
1. วิเคราะห์หุ้นและตอบคำถามเกี่ยวกับการลงทุน หุ้น ตลาดทุน และเศรษฐกิจ อย่างแม่นยำและเข้าใจง่าย
2. ให้ข้อมูลเชิงลึกที่ช่วยในการตัดสินใจ โดยอ้างอิงจากข้อมูลล่าสุดและสภาวะตลาด (Fear & Greed Index)
3. ใช้โครงสร้างการตอบ: [บทสรุปและสภาวะตลาด] -> [คำแนะนำ/Action Plan] -> [ความเสี่ยง]
4. ใช้คำลงท้ายที่สุภาพ (ครับ/ค่ะ) และทักทายอย่างสั้นและกระชับที่สุดเพื่อไม่ให้บังส่วนเนื้อหาสำคัญ`;

// --- UTILITY FUNCTIONS ---
async function getMarketSentiment() {
    try {
        const stockRes = await axios.get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
        });
        const cryptoRes = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 8000 });
        return {
            stock: { score: Math.round(stockRes.data.fear_and_greed.score), rating: stockRes.data.fear_and_greed.rating },
            crypto: { score: cryptoRes.data.data[0].value, rating: cryptoRes.data.data[0].value_classification }
        };
    } catch (e) { return null; }
}

async function getStockProfile(symbol) {
    try {
        const searchRes = await axios.get(`https://query2.finance.yahoo.com/v1/finance/search?q=${symbol}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const quote = searchRes.data.quotes.find(q => q.symbol.toUpperCase() === symbol.toUpperCase());
        if (quote) {
            if (quote.quoteType === 'CRYPTOCURRENCY' || quote.typeDisp === 'cryptocurrency') return { sector: 'Cryptocurrency' };
            if (quote.sector) return { sector: quote.sector };
        }
        const res = await axios.get(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        return res.data.quoteSummary.result[0].assetProfile;
    } catch (e) { 
        if (symbol.toUpperCase().includes('BTC') || symbol.toUpperCase().includes('ETH') || symbol.toUpperCase().endsWith('-USD')) return { sector: 'Cryptocurrency' };
        return null; 
    }
}

async function getUpcomingEarnings(symbol) {
    try {
        const res = await axios.get(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=calendarEvents`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const events = res.data.quoteSummary.result[0].calendarEvents;
        return events && events.earnings ? events.earnings.earningsDate[0].fmt : null;
    } catch (e) { return null; }
}

async function getAIAnalysis(prompt, specializedInstruction = null) {
    try {
        const sentiment = await getMarketSentiment();
        const sentimentContext = sentiment ? `\nMarket Sentiment Today: Stock Index is ${sentiment.stock.score} (${sentiment.stock.rating}), Crypto Index is ${sentiment.crypto.score} (${sentiment.crypto.rating})` : "";
        const model = genAI.getGenerativeModel({ model: MODEL_NAME, systemInstruction: (specializedInstruction || systemInstruction) + sentimentContext });
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) {
        console.error("AI Error:", e);
        return "⚠️ AI ไม่สามารถวิเคราะห์ได้ในขณะนี้";
    }
}

async function sendEmbedResponse(interaction, title, description, color = 0x0099FF) {
    const maxLength = 4000;
    if (description.length <= maxLength) {
        const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
    }
    const chunks = [];
    for (let i = 0; i < description.length; i += maxLength) chunks.push(description.substring(i, i + maxLength));
    const firstEmbed = new EmbedBuilder().setTitle(title).setDescription(chunks[0]).setColor(color);
    await interaction.editReply({ embeds: [firstEmbed] });
    for (let i = 1; i < chunks.length; i++) {
        const nextEmbed = new EmbedBuilder().setDescription(chunks[i]).setColor(color);
        await interaction.followUp({ embeds: [nextEmbed] });
    }
}

async function getStockNews(symbol) {
    try {
        const response = await axios.get(`https://www.google.com/search?q=${symbol}+stock+news&tbm=nws`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const $ = cheerio.load(response.data);
        let news = [];
        $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => { if (i < 3) news.push($(el).text()); });
        return news.length > 0 ? news.join(' | ') : "No recent news found";
    } catch (e) { return "News unavailable"; }
}

async function getMarketTrending() {
    try {
        const response = await axios.get(`https://www.google.com/search?q=top+trending+stocks+today+usa+market&tbm=nws`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const $ = cheerio.load(response.data);
        let trends = [];
        $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => { if (i < 5) trends.push($(el).text()); });
        return trends.join(' | ');
    } catch (e) { return "Unable to fetch global trends"; }
}

async function getStockPrice(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const result = response.data.chart.result[0].meta;
        return { price: result.regularMarketPrice, previousClose: result.previousClose, symbol: result.symbol };
    } catch (error) { throw error; }
}

// --- SCHEDULED JOBS ---

// แจ้งเตือนราคาขยับแรง ทุก 30 นาที (อัปเดตระบบ Anti-Spam SL/TP)
cron.schedule('*/30 * * * 1-5', async () => {
    const allStocks = await Watchlist.find({});
    for (const item of allStocks) {
        try {
            const quote = await getStockPrice(item.symbol);
            const user = await client.users.fetch(item.userId);

            // 1. ตรวจสอบ Stop Loss
            if (item.stopLoss > 0 && quote.price <= item.stopLoss) {
                const analysis = await getAIAnalysis(`หุ้น ${item.symbol} หลุดจุด Stop Loss ที่ $${item.stopLoss} (ราคาปัจจุบัน $${quote.price}) วิเคราะห์กลยุทธ์การขายด่วน!`);
                await user.send(`⚠️ **STOP LOSS ALERT: ${item.symbol}**\nราคาปัจจุบัน: $${quote.price}\n${analysis}`);
                
                item.stopLoss = 0; // Reset เพื่อกันแจ้งเตือนซ้ำรัวๆ
                await item.save();
                continue;
            }

            // 2. ตรวจสอบ Target Price
            if (item.targetPrice > 0 && quote.price >= item.targetPrice) {
                const analysis = await getAIAnalysis(`หุ้น ${item.symbol} ถึงจุดขายทำกำไรที่ $${item.targetPrice} (ราคาปัจจุบัน $${quote.price}) แนะนำวิธีกระจายขายทำกำไร`);
                await user.send(`🎯 **TARGET REACHED: ${item.symbol}**\nราคาปัจจุบัน: $${quote.price}\n${analysis}`);
                
                item.targetPrice = 0; // Reset เพื่อกันแจ้งเตือนซ้ำ
                await item.save();
                continue;
            }

            // 3. Volatility Check
            const change = ((quote.price - quote.previousClose) / quote.previousClose * 100);
            if (Math.abs(change) >= 3) {
                const news = await getStockNews(item.symbol);
                const analysis = await getAIAnalysis(`${item.symbol} ขยับแรง ${change.toFixed(2)}% ข่าว: ${news} สรุปสั้นๆ`);
                await user.send(`📢 **Volatility Alert: ${item.symbol}**\n${analysis}`);
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

// Earnings Call Reminder (08:00 น.)
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

// Morning Brief (20:30 น.)
cron.schedule('30 20 * * 1-5', async () => {
    const userIds = await Watchlist.distinct('userId');
    for (const id of userIds) {
        try {
            const stocks = await Watchlist.find({ userId: id });
            if (stocks.length === 0) continue;

            const newsPromises = stocks.map(stock => getStockNews(stock.symbol).then(news => ({ symbol: stock.symbol, news })));
            const newsResults = await Promise.all(newsPromises);
            const newsContext = newsResults.map(item => `${item.symbol}: ${item.news}`).join('\n');
            const prompt = `นี่คือข่าวล่าสุดของหุ้นในพอร์ต:\n${newsContext}\n\nช่วยสรุปเป็น "Morning Brief" ก่อนตลาดเปิด`;
            
            const summary = await getAIAnalysis(prompt);
            const user = await client.users.fetch(id);
            await user.send(`☕ **Your Morning Brief**\n\n${summary}`);
        } catch (e) { console.error(`Failed to send Morning Brief to ${id}:`, e.message); }
    }
});

// Daily P/L Snapshot (04:30 น.)
cron.schedule('30 4 * * 2-6', async () => {
    const userIds = await Watchlist.distinct('userId');
    for (const id of userIds) {
        try {
            const stocks = await Watchlist.find({ userId: id });
            if (stocks.length < 1) continue;

            let totalValuePrevious = 0; let totalValueCurrent = 0; let stockChanges = [];

            for (const stock of stocks) {
                try {
                    const quote = await getStockPrice(stock.symbol);
                    if (!quote || !quote.price || !quote.previousClose) continue;

                    totalValuePrevious += stock.amount * quote.previousClose;
                    totalValueCurrent += stock.amount * quote.price;
                    const dailyChange = (quote.price - quote.previousClose) * stock.amount;
                    stockChanges.push({ symbol: stock.symbol, change: dailyChange });
                } catch (e) { continue; }
            }
            
            if (totalValuePrevious === 0) continue;

            const totalPnl = totalValueCurrent - totalValuePrevious;
            const totalPnlPercent = (totalPnl / totalValuePrevious) * 100;
            const pnlStatus = totalPnl >= 0 ? "บวก" : "ลบ";
            const pnlEmoji = totalPnl >= 0 ? "🟢" : "🔴";

            stockChanges.sort((a, b) => b.change - a.change);
            const topPerformer = stockChanges[0];
            const worstPerformer = stockChanges[stockChanges.length - 1];

            let summary = `${pnlEmoji} วันนี้พอร์ตของคุณ${pnlStatus}ไป **$${Math.abs(totalPnl).toFixed(2)}** (${totalPnlPercent.toFixed(2)}%)\n`;
            if (topPerformer) summary += `💪 ตัวที่แบกพอร์ต: **${topPerformer.symbol}** ($${topPerformer.change.toFixed(2)})\n`;
            if (worstPerformer && worstPerformer.change < 0 && stockChanges.length > 1) {
                summary += `😥 ตัวที่ถ่วงพอร์ต: **${worstPerformer.symbol}** ($${worstPerformer.change.toFixed(2)})`;
            }

            const user = await client.users.fetch(id);
            await user.send(`**🗓️ Daily P/L Snapshot**\n${summary}`);
        } catch (e) { console.error(`Failed Daily P/L for ${id}:`, e.message); }
    }
});

// --- BOT EVENTS ---

client.once('ready', async () => {
    console.log(`🤖 AI Bot Ready: ${client.user.tag}`);
    await mongoose.connect(process.env.MONGODB_URI);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'analyze-portfolio') {
        await interaction.deferReply();
        try {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");
            
            let portfolio = [];
            for (const s of stocks) {
                try {
                    const q = await getStockPrice(s.symbol);
                    const n = await getStockNews(s.symbol);
                    portfolio.push({ symbol: s.symbol, profit: (q.price - s.avgPrice).toFixed(2), news: n });
                } catch (e) { portfolio.push({ symbol: s.symbol, profit: 'N/A', news: 'N/A' }); }
            }
            const analysis = await getAIAnalysis(`วิเคราะห์พอร์ต: ${JSON.stringify(portfolio)} เน้นสภาวะตลาดและ Action Plan`);
            await sendEmbedResponse(interaction, "🤖 AI Strategic Analysis", analysis, 0x00FF00);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาดในการวิเคราะห์พอร์ต กรุณาลองใหม่"); }

    } else if (interaction.commandName === 'ask') {
        await interaction.deferReply();
        try {
            const question = interaction.options.getString('question');
            const market = await getMarketTrending();
            const analystInstruction = `คุณคือ 'Senior Wealth Advisor' ข้อมูลตลาดวันนี้: ${market} กรุณาตอบคำถามโดยเน้นความถูกต้องและให้มุมมองที่รอบด้าน`;
            const analysis = await getAIAnalysis(`คำถามนักลงทุน: "${question}"`, analystInstruction);
            await sendEmbedResponse(interaction, `💬 Investor Q&A: ${question.substring(0, 100)}`, analysis);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาด กรุณาลองใหม่"); }

    } else if (interaction.commandName === 'watchlist') {
        await interaction.deferReply();
        try {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");
            
            let res = []; let total = 0;
            for (const s of stocks) {
                try {
                    const q = await getStockPrice(s.symbol);
                    const p = (q.price - s.avgPrice) * s.amount; total += p;
                    // อัปเดตให้แสดง SL และ TP ด้วย
                    let slText = s.stopLoss > 0 ? ` | SL: $${s.stopLoss}` : '';
                    let tpText = s.targetPrice > 0 ? ` | TP: $${s.targetPrice}` : '';
                    res.push(`${p >= 0 ? '🟢' : '🔴'} **${s.symbol}**: $${q.price.toFixed(2)} (กำไร: $${p.toFixed(2)})${slText}${tpText}`);
                } catch (e) {
                    res.push(`⚪ **${s.symbol}**: ดึงราคาไม่ได้`);
                }
            }
            const description = `📊 **Overview**\n${res.join('\n')}\n\n💰 **Total P/L: $${total.toFixed(2)}**`;
            await sendEmbedResponse(interaction, "My Watchlist", description, 0xFFA500);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาด กรุณาลองใหม่"); }

    } else if (interaction.commandName === 'stock') {
        await interaction.deferReply();
        try {
            const sym = interaction.options.getString('symbol').toUpperCase();
            const q = await getStockPrice(sym);
            const n = await getStockNews(sym);
            const analysis = await getAIAnalysis(`หุ้น ${sym} ราคา $${q.price} ข่าว: ${n} วิเคราะห์ความน่าสนใจสั้นๆ`);
            await sendEmbedResponse(interaction, `📈 Stock Analysis: ${sym}`, `**Current Price:** $${q.price.toFixed(2)}\n\n${analysis}`);
        } catch (e) { await interaction.editReply("❌ ไม่พบข้อมูลหุ้น"); }

    } else if (interaction.commandName === 'discover') {
        await interaction.deferReply();
        try {
            const market = await getMarketTrending();
            const analysis = await getAIAnalysis(`จากข่าวตลาดวันนี้: ${market} แนะนำหุ้นที่น่าจับตาที่สุด 2 ตัวพร้อมเหตุผลเชิงกลยุทธ์`);
            await sendEmbedResponse(interaction, "🔎 AI Discovery", analysis, 0x9B59B6);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาด กรุณาลองใหม่"); }

    } else if (interaction.commandName === 'sentiment') {
        await interaction.deferReply();
        try {
            const sentiment = await getMarketSentiment();
            if (!sentiment) return await interaction.editReply("❌ ไม่สามารถดึงข้อมูลได้");
            const analysis = await getAIAnalysis(`สภาวะตลาด: หุ้น ${sentiment.stock.score}, คริปโต ${sentiment.crypto.score} อธิบายว่าควรลงทุนอย่างไร`);
            const description = `📊 **Stock Fear & Greed:** ${sentiment.stock.score} (${sentiment.stock.rating})\n🪙 **Crypto Fear & Greed:** ${sentiment.crypto.score} (${sentiment.crypto.rating})\n\n💡 **AI Advice:** ${analysis}`;
            await sendEmbedResponse(interaction, "🌍 Global Market Sentiment", description, 0xFFFF00);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาด กรุณาลองใหม่"); }

    } else if (interaction.commandName === 'analyze-diversification') {
        await interaction.deferReply();
        try {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");

            let sectorAllocation = {}; let sectorStocks = {}; let totalValue = 0;
            const results = await Promise.allSettled(
                stocks.map(async (s) => {
                    const q = await getStockPrice(s.symbol);
                    const profile = await getStockProfile(s.symbol);
                    const sector = profile ? (profile.sector || "Unknown") : "Unknown";
                    const value = q.price * s.amount;
                    return { symbol: s.symbol, sector, value };
                })
            );

            for (const result of results) {
                if (result.status === 'fulfilled') {
                    const { symbol, sector, value } = result.value;
                    sectorAllocation[sector] = (sectorAllocation[sector] || 0) + value;
                    if (!sectorStocks[sector]) sectorStocks[sector] = [];
                    sectorStocks[sector].push(symbol);
                    totalValue += value;
                }
            }

            if (totalValue === 0) return await interaction.editReply("❌ ไม่สามารถดึงข้อมูลได้");

            let allocationText = [];
            for (const sector in sectorAllocation) {
                const percent = (sectorAllocation[sector] / totalValue * 100).toFixed(2);
                const symbols = sectorStocks[sector].join(', ');
                allocationText.push(`- **${sector}:** ${percent}% (${symbols})`);
            }

            const analysis = await getAIAnalysis(`วิเคราะห์พอร์ต: ${JSON.stringify(sectorAllocation)} หุ้น: ${JSON.stringify(sectorStocks)}`);
            const description = `📈 **Current Sector Allocation:**\n${allocationText.join('\n')}\n\n🕵️ **AI Risk Analysis:**\n${analysis}`;
            await sendEmbedResponse(interaction, "🧩 Portfolio Diversification Review", description, 0x3498DB);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาดในการวิเคราะห์"); }

    } else if (interaction.commandName === 'add-stock') {
        await interaction.deferReply();
        try {
            const s = interaction.options.getString('symbol').toUpperCase();
            const a = interaction.options.getNumber('amount');
            const p = interaction.options.getNumber('avg_price');
            const sl = interaction.options.getNumber('stop_loss') || 0;
            const tp = interaction.options.getNumber('target_price') || 0;

            let stock = await Watchlist.findOne({ userId: interaction.user.id, symbol: s });
            if (stock) {
                stock.avgPrice = ((stock.amount * stock.avgPrice) + (a * p)) / (stock.amount + a);
                stock.amount += a;
                if (sl > 0) stock.stopLoss = sl;
                if (tp > 0) stock.targetPrice = tp;
                await stock.save();
            } else {
                await Watchlist.create({ userId: interaction.user.id, symbol: s, amount: a, avgPrice: p, stopLoss: sl, targetPrice: tp });
            }
            await Transaction.create({ userId: interaction.user.id, symbol: s, type: 'BUY', amount: a, price: p });
            await interaction.editReply(`✅ บันทึกหุ้น **${s}** เรียบร้อย! (SL: $${sl}, TP: $${tp})`);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาดในการเพิ่มหุ้น"); }

    } else if (interaction.commandName === 'remove-stock') {
        await interaction.deferReply();
        try {
            const s = interaction.options.getString('symbol').toUpperCase();
            const stockToRemove = await Watchlist.findOne({ userId: interaction.user.id, symbol: s });
            if (!stockToRemove) return await interaction.editReply(`❌ ไม่พบหุ้น **${s}** ในพอร์ต`);

            try {
                const quote = await getStockPrice(s);
                await Transaction.create({ userId: interaction.user.id, symbol: s, type: 'SELL', amount: stockToRemove.amount, price: quote.price });
            } catch (e) { console.error("Could not record SELL transaction:", e.message); }

            await Watchlist.deleteOne({ userId: interaction.user.id, symbol: s });
            await interaction.editReply(`✅ ลบหุ้น **${s}** ออกจากพอร์ตเรียบร้อยแล้ว`);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาดในการลบหุ้น"); }

    } else if (interaction.commandName === 'update-stock') {
        await interaction.deferReply();
        try {
            const s = interaction.options.getString('symbol').toUpperCase();
            const a = interaction.options.getNumber('amount');
            const p = interaction.options.getNumber('avg_price');
            const sl = interaction.options.getNumber('stop_loss');
            const tp = interaction.options.getNumber('target_price');

            const stock = await Watchlist.findOne({ userId: interaction.user.id, symbol: s });
            if (!stock) return await interaction.editReply(`❌ ไม่พบหุ้น **${s}** ในพอร์ต`);

            stock.amount = a;
            stock.avgPrice = p;
            if (sl !== null && sl !== undefined) stock.stopLoss = sl;
            if (tp !== null && tp !== undefined) stock.targetPrice = tp;
            await stock.save();
            await interaction.editReply(`✅ อัปเดตหุ้น **${s}** เรียบร้อย!`);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาดในการอัปเดต"); }

    } else if (interaction.commandName === 'history') {
        await interaction.deferReply();
        try {
            const symbol = interaction.options.getString('symbol')?.toUpperCase();
            let query = { userId: interaction.user.id };
            if (symbol) query.symbol = symbol;

            const logs = await Transaction.find(query).sort({ date: -1 }).limit(25);
            const text = logs.length > 0 
                ? logs.map(l => {
                    const date = new Date(l.date).toLocaleDateString('en-CA');
                    const emoji = l.type === 'BUY' ? '🟢' : '🔴';
                    return `\`[${date}]\` ${emoji} **${l.symbol}**: ${l.amount} หุ้น @ $${l.price.toFixed(2)}`;
                }).join('\n')
                : 'ไม่พบประวัติการทำรายการ';

            const title = symbol ? `📜 ประวัติการทำรายการ: ${symbol}` : '📜 ประวัติการทำรายการล่าสุด';
            await sendEmbedResponse(interaction, title, text, 0x7289DA);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาดในการดึงประวัติ"); }
    }
});

client.login(process.env.DISCORD_TOKEN);