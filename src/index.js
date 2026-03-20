const express = require('express');
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// --- SETUP SERVER & CLIENT ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('AI Alpha Bot is running!'));
app.listen(port, () => console.log(`🌍 Server is listening on port ${port}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// --- MODELS ---
const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');

// --- AI CONFIG ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-2.0-flash";  // เปลี่ยนเป็น 2.0 Flash เพื่อความเสถียรสูงสุด

const systemInstruction = `คุณคือ 'AI Alpha' ผู้เชี่ยวชาญด้านการวิเคราะห์การลงทุนและที่ปรึกษาทางการเงินส่วนตัว
บุคลิกของคุณ: สุภาพ, เป็นกันเองแต่เป็นมืออาชีพ, มั่นใจ และให้เกียรติผู้ใช้งาน
หน้าที่ของคุณ:
1. วิเคราะห์หุ้นและตอบคำถามเกี่ยวกับการลงทุน หุ้น ตลาดทุน และเศรษฐกิจ อย่างแม่นยำและเข้าใจง่าย
2. ให้ข้อมูลเชิงลึกที่ช่วยในการตัดสินใจ โดยอ้างอิงจากข้อมูลล่าสุดและสภาวะตลาด (Fear & Greed Index)
3. ใช้โครงสร้างการตอบ: [บทสรุปและสภาวะตลาด] -> [คำแนะนำ/Action Plan] -> [ความเสี่ยง]
4. ใช้คำลงท้ายที่สุภาพ (ครับ/ค่ะ) และทักทายอย่างสั้นและกระชับที่สุด`;

const MARKET_LEADERS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'META', 'GOOGL', 'AMZN', 'NFLX', 'AMD', 'COIN', 'BTC-USD'];

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

async function getStockPrice(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const result = response.data.chart.result[0].meta;
        return { price: result.regularMarketPrice, previousClose: result.previousClose, symbol: result.symbol };
    } catch (error) { throw new Error(`Price unavailable for ${symbol}`); }
}

async function getStockProfile(symbol) {
    try {
        const searchRes = await axios.get(`https://query2.finance.yahoo.com/v1/finance/search?q=${symbol}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const quote = searchRes.data.quotes.find(q => q.symbol.toUpperCase() === symbol.toUpperCase());
        if (quote && (quote.sector || quote.typeDisp === 'cryptocurrency')) {
            return { sector: quote.sector || (quote.typeDisp === 'cryptocurrency' ? 'Cryptocurrency' : 'Unknown') };
        }
        return { sector: "Other" };
    } catch (e) { return { sector: "Unknown" }; }
}

async function getAIAnalysis(prompt, specializedInstruction = null) {
    try {
        const sentiment = await getMarketSentiment();
        const sentimentContext = sentiment ? `\nMarket Sentiment: Stock ${sentiment.stock.score} (${sentiment.stock.rating}), Crypto ${sentiment.crypto.score} (${sentiment.crypto.rating})` : "";
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME, 
            systemInstruction: (specializedInstruction || systemInstruction) + sentimentContext 
        });
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) {
        console.error("AI Error:", e.message);
        return `⚠️ AI เกิดข้อผิดพลาด: ${e.message.includes('model not found') ? 'ชื่อโมเดลไม่ถูกต้อง' : 'กรุณาลองใหม่อีกครั้งหรือเช็ค API Key'}`;
    }
}

async function sendEmbedResponse(interaction, title, description, color = 0x0099FF) {
    const maxLength = 3900;
    if (description.length <= maxLength) {
        const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
    }
    const chunks = description.match(/[\s\S]{1,3900}/g) || [];
    const firstEmbed = new EmbedBuilder().setTitle(title).setDescription(chunks[0]).setColor(color);
    await interaction.editReply({ embeds: [firstEmbed] });
    for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ embeds: [new EmbedBuilder().setDescription(chunks[i]).setColor(color)] });
    }
}

async function getStockNews(symbol) {
    try {
        const res = await axios.get(`https://www.google.com/search?q=${symbol}+stock+news&tbm=nws`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const $ = cheerio.load(res.data);
        let news = [];
        $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => { if (i < 3) news.push($(el).text()); });
        return news.length > 0 ? news.join(' | ') : "No news found";
    } catch (e) { return "News unavailable"; }
}

// --- BOT EVENTS & COMMANDS ---

client.once('ready', async () => {
    console.log(`🤖 AI Bot Ready: ${client.user.tag}`);
    await mongoose.connect(process.env.MONGODB_URI);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        // 1. ANALYZE PORTFOLIO
        if (interaction.commandName === 'analyze-portfolio') {
            await interaction.deferReply();
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");

            const portfolioData = await Promise.all(stocks.map(async (s) => {
                try {
                    const q = await getStockPrice(s.symbol);
                    const n = await getStockNews(s.symbol);
                    const totalProfit = (q.price - s.avgPrice) * s.amount;
                    return { 
                        symbol: s.symbol, 
                        shares: s.amount,
                        avgPrice: s.avgPrice,
                        currentPrice: q.price,
                        profit: totalProfit.toFixed(2), 
                        news: n 
                    };
                } catch (e) { return { symbol: s.symbol, error: 'Price/News unavailable' }; }
            }));

            const analysis = await getAIAnalysis(`วิเคราะห์พอร์ตลงทุนปัจจุบัน (JSON Format): ${JSON.stringify(portfolioData)}
กรุณาให้คำแนะนำเชิงกลยุทธ์แบบมืออาชีพ โดยอ้างอิงจากราคาปัจจุบันและข่าวสารที่เกิดขึ้น`);
            await sendEmbedResponse(interaction, "🤖 AI Strategic Analysis", analysis, 0x00FF00);

        // 2. WATCHLIST
        } else if (interaction.commandName === 'watchlist') {
            await interaction.deferReply();
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");

            const results = await Promise.all(stocks.map(async (s) => {
                try {
                    const q = await getStockPrice(s.symbol);
                    const p = (q.price - s.avgPrice) * s.amount;
                    return { 
                        text: `${p >= 0 ? '🟢' : '🔴'} **${s.symbol}**: $${q.price.toFixed(2)} (P/L: $${p.toFixed(2)})`, 
                        profit: p 
                    };
                } catch (e) { return { text: `⚪ **${s.symbol}**: N/A`, profit: 0 }; }
            }));

            const total = results.reduce((sum, r) => sum + r.profit, 0);
            const resText = results.map(r => r.text).join('\n');

            await sendEmbedResponse(interaction, "My Watchlist", `📊 **Overview**\n${resText}\n\n💰 **Total P/L: $${total.toFixed(2)}**`, 0xFFA500);

        // 3. ANALYZE DIVERSIFICATION
        } else if (interaction.commandName === 'analyze-diversification') {
            await interaction.deferReply();
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");

            let sectorAllocation = {}; let sectorStocks = {}; let totalValue = 0;
            const results = await Promise.all(stocks.map(async (s) => {
                try {
                    const q = await getStockPrice(s.symbol);
                    const prof = await getStockProfile(s.symbol);
                    return { symbol: s.symbol, sector: prof.sector, value: q.price * s.amount };
                } catch (e) { return null; }
            }));

            results.forEach(r => {
                if (!r) return;
                sectorAllocation[r.sector] = (sectorAllocation[r.sector] || 0) + r.value;
                if (!sectorStocks[r.sector]) sectorStocks[r.sector] = [];
                sectorStocks[r.sector].push(r.symbol);
                totalValue += r.value;
            });

            let allocationText = Object.keys(sectorAllocation).map(sec => {
                const pct = (sectorAllocation[sec] / totalValue * 100).toFixed(2);
                return `- **${sec}:** ${pct}% (${sectorStocks[sec].join(', ')})`;
            }).join('\n');

            const analysis = await getAIAnalysis(`วิเคราะห์การกระจายความเสี่ยง: ${JSON.stringify(sectorAllocation)}`);
            await sendEmbedResponse(interaction, "🧩 Portfolio Diversification", `📈 **Allocation:**\n${allocationText}\n\n🕵️ **AI Analysis:**\n${analysis}`, 0x3498DB);

        // 4. UPDATE STOCK
        } else if (interaction.commandName === 'update-stock') {
            await interaction.deferReply();
            const s = interaction.options.getString('symbol').toUpperCase();
            const a = interaction.options.getNumber('amount');
            const p = interaction.options.getNumber('avg_price');

            const stock = await Watchlist.findOne({ userId: interaction.user.id, symbol: s });
            if (!stock) return await interaction.editReply(`❌ ไม่พบหุ้น **${s}** ในพอร์ต`);

            stock.amount = a;
            stock.avgPrice = p;
            await stock.save();

            // บันทึกประวัติการอัปเดต
            await Transaction.create({ userId: interaction.user.id, symbol: s, type: 'UPDATE', amount: a, price: p });

            await interaction.editReply(`✅ อัปเดตหุ้น **${s}** เป็น ${a} หุ้น ที่ราคาเฉลี่ย $${p} เรียบร้อย!`);

        // 5. ADD STOCK
        } else if (interaction.commandName === 'add-stock') {
            await interaction.deferReply();
            const s = interaction.options.getString('symbol').toUpperCase();
            const a = interaction.options.getNumber('amount');
            const p = interaction.options.getNumber('avg_price');

            let stock = await Watchlist.findOne({ userId: interaction.user.id, symbol: s });
            if (stock) {
                stock.avgPrice = ((stock.amount * stock.avgPrice) + (a * p)) / (stock.amount + a);
                stock.amount += a;
                await stock.save();
            } else {
                await Watchlist.create({ userId: interaction.user.id, symbol: s, amount: a, avgPrice: p });
            }
            await Transaction.create({ userId: interaction.user.id, symbol: s, type: 'BUY', amount: a, price: p });
            await interaction.editReply(`✅ เพิ่มหุ้น **${s}** เข้าพอร์ตเรียบร้อย!`);

        // 6. STOCK (Single Analysis)
        } else if (interaction.commandName === 'stock') {
            await interaction.deferReply();
            const sym = interaction.options.getString('symbol').toUpperCase();
            const q = await getStockPrice(sym);
            const n = await getStockNews(sym);
            const analysis = await getAIAnalysis(`วิเคราะห์หุ้น ${sym} ราคา $${q.price} ข่าว: ${n}`);
            await sendEmbedResponse(interaction, `📈 Analysis: ${sym}`, `**Price:** $${q.price}\n\n${analysis}`);

        // 7. ASK
        } else if (interaction.commandName === 'ask') {
            await interaction.deferReply();
            const question = interaction.options.getString('question');
            const analysis = await getAIAnalysis(`ผู้ใช้ถามว่า: ${question}`);
            await sendEmbedResponse(interaction, "💬 AI Q&A", analysis);

        // 8. REMOVE STOCK
        } else if (interaction.commandName === 'remove-stock') {
            await interaction.deferReply();
            const s = interaction.options.getString('symbol').toUpperCase();
            const result = await Watchlist.deleteOne({ userId: interaction.user.id, symbol: s });
            if (result.deletedCount > 0) {
                await interaction.editReply(`🗑️ ลบหุ้น **${s}** ออกจากพอร์ตเรียบร้อยแล้ว`);
            } else {
                await interaction.editReply(`❌ ไม่พบหุ้น **${s}** ในพอร์ตของคุณ`);
            }

        // 9. SENTIMENT
        } else if (interaction.commandName === 'sentiment') {
            await interaction.deferReply();
            const s = await getMarketSentiment();
            if (!s) return await interaction.editReply("❌ ไม่สามารถดึงข้อมูลสภาวะตลาดได้ในขณะนี้");
            const msg = `**Stock Market (Fear & Greed):** ${s.stock.score} (${s.stock.rating})\n**Crypto Market:** ${s.crypto.score} (${s.crypto.rating})`;
            await sendEmbedResponse(interaction, "🌡️ Market Sentiment", msg, 0xFFFF00);

        // 10. DISCOVER
        } else if (interaction.commandName === 'discover') {
            await interaction.deferReply();
            const analysis = await getAIAnalysis("ช่วยแนะนำหุ้นเด่นที่น่าสนใจ 3 ตัวสำหรับสภาวะตลาดวันนี้ พร้อมเหตุผลประกอบสั้นๆ");
            await sendEmbedResponse(interaction, "🌟 AI Investment Discovery", analysis, 0x9B59B6);

        // 11. HISTORY
        } else if (interaction.commandName === 'history') {
            await interaction.deferReply();
            const logs = await Transaction.find({ userId: interaction.user.id }).sort({ _id: -1 }).limit(10);
            if (logs.length === 0) return await interaction.editReply("📭 ยังไม่มีประวัติการทำรายการครับ");
            const text = logs.map(l => `🔹 **${l.type}** ${l.symbol} | ${l.amount} หุ้น | $${l.price}`).join('\n');
            await interaction.editReply(`📜 **ประวัติการทำรายการ (10 รายการล่าสุด)**\n${text}`);
        }

    } catch (err) {
        console.error("Command Execution Error:", err);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply("❌ เกิดข้อผิดพลาดทางเทคนิค กรุณาลองใหม่อีกครั้งครับ");
        } else {
            await interaction.reply({ content: "❌ เกิดข้อผิดพลาดทางเทคนิค กรุณาลองใหม่อีกครั้งครับ", ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);