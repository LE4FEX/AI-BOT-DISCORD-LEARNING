const express = require('express');
const path = require('path');
const fs = require('fs');
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- 🛠️ ฟังก์ชัน "นักสืบ" สำหรับดึง Model ---
function smartRequire(targetFile) {
    const searchDirs = [
        path.join(process.cwd(), 'models'),
        path.join(process.cwd(), 'src', 'models'),
        path.join(__dirname, 'models'),
        path.join(__dirname, '..', 'models')
    ];
    for (let dir of searchDirs) {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            const foundFile = files.find(f => f.toLowerCase() === targetFile.toLowerCase() + '.js');
            if (foundFile) return require(path.join(dir, foundFile));
        }
    }
    throw new Error(`หาไฟล์โมเดล ${targetFile} ไม่เจอครับ`);
}

const Watchlist = smartRequire('watchlist');
const Transaction = smartRequire('transaction');

// --- 🤖 AI CONFIG ---
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://www.cnn.com/markets/fear-and-greed'
            },
            timeout: 8000
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

async function getStockNews(symbol) {
    try {
        const res = await axios.get(`https://www.google.com/search?q=${symbol}+stock+news&tbm=nws`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const $ = cheerio.load(res.data);
        let news = [];
        $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => { if (i < 3) news.push($(el).text()); });
        return news.length > 0 ? news.join(' | ') : "No news found";
    } catch (e) { return "News unavailable"; }
}

async function getUpcomingEarnings(symbol) {
    try {
        const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=calendarEvents`;
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const events = res.data.quoteSummary.result[0].calendarEvents;
        return events && events.earnings ? events.earnings.earningsDate[0].fmt : null;
    } catch (e) { return null; }
}

async function getAIAnalysis(prompt, specializedInstruction = null) {
    if (!genAI) return "⚠️ Gemini API Key is missing. Please check your .env file.";
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
        console.error("AI Error:", e);
        return "⚠️ AI ไม่สามารถวิเคราะห์ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";
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

// --- 🤖 ปรับแต่ง Client ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ] 
});

const commands = [
    new SlashCommandBuilder().setName('stock').setDescription('เช็คราคาหุ้นแบบ Real-time และวิเคราะห์เบื้องต้น').addStringOption(o => o.setName('symbol').setDescription('ตัวย่อหุ้น (เช่น MSFT, NVDA)').setRequired(true)),
    new SlashCommandBuilder().setName('add-stock').setDescription('เพิ่มหุ้นเข้า Watchlist พร้อมราคาต้นทุน').addStringOption(o => o.setName('symbol').setDescription('ชื่อย่อหุ้น').setRequired(true)).addNumberOption(o => o.setName('amount').setDescription('จำนวนหุ้นที่ถือ').setRequired(true)).addNumberOption(o => o.setName('avg_price').setDescription('ราคาเฉลี่ยที่ซื้อมา (USD)').setRequired(true)),
    new SlashCommandBuilder().setName('remove-stock').setDescription('ลบหุ้นออกจาก Watchlist').addStringOption(o => o.setName('symbol').setDescription('ตัวย่อหุ้นที่ต้องการลบ').setRequired(true)),
    new SlashCommandBuilder().setName('watchlist').setDescription('ดูหุ้นทั้งหมดใน Watchlist ของคุณ'),
    new SlashCommandBuilder().setName('update-stock').setDescription('แก้ไขข้อมูลหุ้นในพอร์ต (ใช้เมื่อกรอกผิด)').addStringOption(o => o.setName('symbol').setDescription('ชื่อหุ้น').setRequired(true)).addNumberOption(o => o.setName('amount').setDescription('จำนวนหุ้นที่ถูกต้องทั้งหมด').setRequired(true)).addNumberOption(o => o.setName('avg_price').setDescription('ราคาต้นทุนเฉลี่ยที่ถูกต้อง').setRequired(true)),
    new SlashCommandBuilder().setName('history').setDescription('ดูประวัติการทำรายการ'),
    new SlashCommandBuilder().setName('analyze-portfolio').setDescription('ให้ AI ช่วยวิเคราะห์กลยุทธ์พอร์ตของคุณอย่างละเอียด'),
    new SlashCommandBuilder().setName('ask').setDescription('ถามคำถามเกี่ยวกับการลงทุนกับ AI').addStringOption(o => o.setName('question').setDescription('คำถามที่คุณต้องการทราบ').setRequired(true)),
    new SlashCommandBuilder().setName('discover').setDescription('ให้ AI ช่วยค้นหาหุ้นที่น่าสนใจจากสภาวะตลาดปัจจุบัน'),
    new SlashCommandBuilder().setName('sentiment').setDescription('เช็คสภาวะตลาด (Fear & Greed Index) ทั้งหุ้นและคริปโต'),
    new SlashCommandBuilder().setName('analyze-diversification').setDescription('วิเคราะห์การกระจายความเสี่ยงของพอร์ตตามกลุ่มอุตสาหกรรม'),
].map(cmd => cmd.toJSON());

async function deployCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Commands Registered');
    } catch (e) { console.error('❌ Sync Error:', e.message); }
}

// --- SCHEDULED JOBS ---

// 1. แจ้งเตือนราคาขยับแรง ทุก 30 นาที
cron.schedule('*/30 * * * 1-5', async () => {
    try {
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
            } catch (e) { console.error(`Alert failed for ${item.symbol}:`, e.message); }
        }
    } catch (e) { console.error('Cron Alert error:', e.message); }
});

// 2. Daily Market Pulse (21:30 น.)
cron.schedule('30 21 * * 1-5', async () => {
    try {
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
    } catch (e) { console.error('Cron Market Pulse error:', e.message); }
});

// 3. Earnings Call Reminder (08:00 น.)
cron.schedule('0 8 * * 1-5', async () => {
    try {
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
    } catch (e) { console.error('Cron Earnings error:', e.message); }
});

// 4. Morning Brief (20:30 น.)
cron.schedule('30 20 * * 1-5', async () => {
    try {
        const userIds = await Watchlist.distinct('userId');
        for (const id of userIds) {
            try {
                const stocks = await Watchlist.find({ userId: id });
                if (stocks.length === 0) continue;
                const newsPromises = stocks.map(stock => getStockNews(stock.symbol).then(news => ({ symbol: stock.symbol, news })));
                const newsResults = await Promise.all(newsPromises);
                const analysis = await getAIAnalysis(`สรุปข่าวที่สำคัญสำหรับพอร์ตของฉันคืนนี้: ${JSON.stringify(newsResults)}`);
                const user = await client.users.fetch(id);
                await user.send(`🌅 **Morning Brief: สรุปข่าวก่อนตลาดเปิด**\n\n${analysis}`);
            } catch (e) { console.error(`Morning Brief failed for ${id}:`, e.message); }
        }
    } catch (e) { console.error('Cron Morning Brief error:', e.message); }
});

// --- EVENT HANDLERS ---

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        await interaction.deferReply();

        if (interaction.commandName === 'analyze-portfolio') {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");
            const portfolioData = await Promise.all(stocks.map(async (s) => {
                try {
                    const q = await getStockPrice(s.symbol);
                    const n = await getStockNews(s.symbol);
                    return { symbol: s.symbol, profit: (q.price - s.avgPrice).toFixed(2), news: n };
                } catch (e) { return { symbol: s.symbol, profit: 'N/A', news: 'N/A' }; }
            }));
            const analysis = await getAIAnalysis(`วิเคราะห์พอร์ต: ${JSON.stringify(portfolioData)}`);
            await sendEmbedResponse(interaction, "🤖 AI Strategic Analysis", analysis, 0x00FF00);

        } else if (interaction.commandName === 'watchlist') {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");
            let total = 0;
            const res = await Promise.all(stocks.map(async (s) => {
                try {
                    const q = await getStockPrice(s.symbol);
                    const p = (q.price - s.avgPrice) * s.amount;
                    total += p;
                    return `${p >= 0 ? '🟢' : '🔴'} **${s.symbol}**: $${q.price.toFixed(2)} (P/L: $${p.toFixed(2)})`;
                } catch (e) { return `⚪ **${s.symbol}**: N/A`; }
            }));
            await sendEmbedResponse(interaction, "My Watchlist", `📊 **Overview**\n${res.join('\n')}\n\n💰 **Total P/L: $${total.toFixed(2)}**`, 0xFFA500);

        } else if (interaction.commandName === 'analyze-diversification') {
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

        } else if (interaction.commandName === 'update-stock') {
            const s = interaction.options.getString('symbol').toUpperCase();
            const a = interaction.options.getNumber('amount');
            const p = interaction.options.getNumber('avg_price');
            const stock = await Watchlist.findOne({ userId: interaction.user.id, symbol: s });
            if (!stock) return await interaction.editReply(`❌ ไม่พบหุ้น **${s}** ในพอร์ต`);
            stock.amount = a;
            stock.avgPrice = p;
            await stock.save();
            await interaction.editReply(`✅ อัปเดตหุ้น **${s}** เป็น ${a} หุ้น ที่ราคาเฉลี่ย $${p} เรียบร้อย!`);

        } else if (interaction.commandName === 'add-stock') {
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

        } else if (interaction.commandName === 'stock') {
            const sym = interaction.options.getString('symbol').toUpperCase();
            const q = await getStockPrice(sym);
            const n = await getStockNews(sym);
            const analysis = await getAIAnalysis(`วิเคราะห์หุ้น ${sym} ราคา $${q.price} ข่าว: ${n}`);
            await sendEmbedResponse(interaction, `📈 Analysis: ${sym}`, `**Price:** $${q.price}\n\n${analysis}`);

        } else if (interaction.commandName === 'ask') {
            const question = interaction.options.getString('question');
            const analysis = await getAIAnalysis(`ผู้ใช้ถามว่า: ${question}`);
            await sendEmbedResponse(interaction, "💬 AI Q&A", analysis);

        } else if (interaction.commandName === 'remove-stock') {
            const s = interaction.options.getString('symbol').toUpperCase();
            const result = await Watchlist.deleteOne({ userId: interaction.user.id, symbol: s });
            if (result.deletedCount > 0) {
                await interaction.editReply(`🗑️ ลบหุ้น **${s}** ออกจากพอร์ตเรียบร้อยแล้ว`);
            } else {
                await interaction.editReply(`❌ ไม่พบหุ้น **${s}** ในพอร์ตของคุณ`);
            }

        } else if (interaction.commandName === 'sentiment') {
            const s = await getMarketSentiment();
            if (!s) return await interaction.editReply("❌ ไม่สามารถดึงข้อมูลสภาวะตลาดได้ในขณะนี้");
            const msg = `**Stock Market (Fear & Greed):** ${s.stock.score} (${s.stock.rating})\n**Crypto Market:** ${s.crypto.score} (${s.crypto.rating})`;
            await sendEmbedResponse(interaction, "🌡️ Market Sentiment", msg, 0xFFFF00);

        } else if (interaction.commandName === 'discover') {
            const analysis = await getAIAnalysis("ช่วยแนะนำหุ้นเด่นที่น่าสนใจ 3 ตัวสำหรับสภาวะตลาดวันนี้ พร้อมเหตุผลประกอบสั้นๆ");
            await sendEmbedResponse(interaction, "🌟 AI Investment Discovery", analysis, 0x9B59B6);

        } else if (interaction.commandName === 'history') {
            const logs = await Transaction.find({ userId: interaction.user.id }).sort({ _id: -1 }).limit(10);
            if (logs.length === 0) return await interaction.editReply("📭 ยังไม่มีประวัติการทำรายการครับ");
            const text = logs.map(l => `🔹 **${l.type}** ${l.symbol} | ${l.amount} หุ้น | $${l.price}`).join('\n');
            await interaction.editReply(`📜 **ประวัติการทำรายการ (10 รายการล่าสุด)**\n${text}`);
        }

    } catch (err) {
        console.error("Command Execution Error:", err);
        const errorMsg = err.message.includes('Price unavailable') ? `❌ ไม่พบข้อมูลหุ้นที่ระบุ` : "❌ เกิดข้อผิดพลาดทางเทคนิค กรุณาลองใหม่อีกครั้งครับ";
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errorMsg);
        } else {
            await interaction.reply({ content: errorMsg, ephemeral: true });
        }
    }
});

// --- 🚀 เริ่มระบบ ---
async function start() {
    try {
        console.log('--- 🚀 Starting Jarvis AI Alpha Services ---');
        
        const rawToken = process.env.DISCORD_TOKEN;
        const rawMongo = process.env.MONGODB_URI;

        if (!rawToken) throw new Error('❌ Missing DISCORD_TOKEN');
        if (!rawMongo) throw new Error('❌ Missing MONGODB_URI');

        const cleanToken = rawToken.replace(/["']/g, '').trim();
        const cleanMongo = rawMongo.trim();

        console.log('⏳ Connecting to MongoDB...');
        await mongoose.connect(cleanMongo);
        console.log('✅ DB Connected Successfully');

        client.once(Events.ClientReady, async (c) => {
            console.log('******************************************');
            console.log(`✅ SUCCESS! Jarvis is Online as: ${c.user.tag}`);
            console.log('******************************************');
            await deployCommands(); 
        });

        client.on(Events.Error, (error) => {
            console.error('❌ Discord Client Error:', error);
        });

        // Debug logs
        client.on('debug', (info) => {
            if (info.includes('Session')) console.log(`ℹ️ [Discord Debug] ${info}`);
        });

        console.log('🔐 Attempting Discord Login...');
        await client.login(cleanToken);

    } catch (err) {
        console.error('❌ BOOT ERROR:', err.message);
    }
}

// Health Check สำหรับ Render
app.get('/', (req, res) => res.status(200).send('Jarvis AI Alpha is Live and Running!'));

app.listen(port, '0.0.0.0', () => {
    console.log(`🌍 Health Check Server active on port ${port}`);
    start(); 
});
