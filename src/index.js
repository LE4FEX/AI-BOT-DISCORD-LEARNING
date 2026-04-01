const express = require('express');
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- 🛠️ Models ---
const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');

// --- 🤖 AI CONFIG ---
const getCleanEnv = (key) => process.env[key]?.replace(/["']/g, '').trim();

const geminiKey = getCleanEnv('GEMINI_API_KEY');
const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const MODEL_NAME = getCleanEnv('GEMINI_MODEL') || "gemini-2.5-flash";

const systemInstruction = `คุณคือ 'AI Alpha' ผู้เชี่ยวชาญด้านการวิเคราะห์การลงทุนและที่ปรึกษาทางการเงินส่วนตัว
บุคลิก: สุภาพ, เป็นกันเองแต่เป็นมืออาชีพ, มั่นใจ
หน้าที่: วิเคราะห์หุ้น ตอบคำถามลงทุน โดยใช้โครงสร้าง [บทสรุป/สภาวะตลาด] -> [คำแนะนำ/Action Plan] -> [ความเสี่ยง]
ใช้คำลงท้ายที่สุภาพ (ครับ/ค่ะ) และทักทายสั้นๆ`;

const MARKET_LEADERS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'META', 'GOOGL', 'AMZN', 'NFLX', 'AMD', 'COIN', 'BTC-USD'];

// --- UTILITY FUNCTIONS ---

const getMarketSentiment = async () => {
    try {
        const [stockRes, cryptoRes] = await Promise.all([
            axios.get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
                headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
            }),
            axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 8000 })
        ]);
        return {
            stock: { score: Math.round(stockRes.data.fear_and_greed.score), rating: stockRes.data.fear_and_greed.rating },
            crypto: { score: cryptoRes.data.data[0].value, rating: cryptoRes.data.data[0].value_classification }
        };
    } catch (e) { return null; }
};

const getStockPrice = async (symbol) => {
    try {
        const res = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const meta = res.data.chart.result[0].meta;
        return { price: meta.regularMarketPrice, previousClose: meta.previousClose, symbol: meta.symbol };
    } catch (e) { throw new Error(`Price unavailable for ${symbol}`); }
};

const getStockProfile = async (symbol) => {
    try {
        const res = await axios.get(`https://query2.finance.yahoo.com/v1/finance/search?q=${symbol}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const quote = res.data.quotes.find(q => q.symbol.toUpperCase() === symbol.toUpperCase());
        return { sector: quote?.sector || (quote?.typeDisp === 'cryptocurrency' ? 'Cryptocurrency' : 'Other') };
    } catch (e) { return { sector: "Unknown" }; }
};

const getStockNews = async (symbol) => {
    try {
        const res = await axios.get(`https://www.google.com/search?q=${symbol}+stock+news&tbm=nws`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
        const $ = cheerio.load(res.data);
        const news = [];
        $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => { if (i < 3) news.push($(el).text()); });
        return news.length ? news.join(' | ') : "No news found";
    } catch (e) { return "News unavailable"; }
};

const getAIAnalysis = async (prompt, specializedInstruction = null) => {
    if (!genAI) return "⚠️ Gemini API Key is missing.";
    try {
        const sentiment = await getMarketSentiment();
        const sentimentCtx = sentiment ? `\nMarket: Stock ${sentiment.stock.score}(${sentiment.stock.rating}), Crypto ${sentiment.crypto.score}(${sentiment.crypto.rating})` : "";
        const model = genAI.getGenerativeModel({ model: MODEL_NAME, systemInstruction: (specializedInstruction || systemInstruction) + sentimentCtx });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
    } catch (e) { 
        console.error("AI Analysis Error:", e.message);
        return "⚠️ AI ไม่สามารถวิเคราะห์ได้ในขณะนี้ (ตรวจสอบความถูกต้องของ API Key หรือลองใหม่อีกครั้ง)"; 
    }
};

const sendEmbed = async (interaction, title, description, color = 0x0099FF) => {
    const chunks = description.match(/[\s\S]{1,3900}/g) || [description];
    const embed = (desc) => new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color).setTimestamp();
    await interaction.editReply({ embeds: [embed(chunks[0])] });
    for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ embeds: [new EmbedBuilder().setDescription(chunks[i]).setColor(color)] });
    }
};

// --- 🤖 Discord Client ---
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const commands = [
    new SlashCommandBuilder().setName('stock').setDescription('เช็คราคาหุ้นและวิเคราะห์').addStringOption(o => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)),
    new SlashCommandBuilder().setName('add-stock').setDescription('เพิ่มหุ้นเข้า Watchlist').addStringOption(o => o.setName('symbol').setDescription('ชื่อย่อหุ้น').setRequired(true)).addNumberOption(o => o.setName('amount').setDescription('จำนวน').setRequired(true)).addNumberOption(o => o.setName('avg_price').setDescription('ราคาเฉลี่ย').setRequired(true)),
    new SlashCommandBuilder().setName('remove-stock').setDescription('ลบหุ้นออก').addStringOption(o => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)),
    new SlashCommandBuilder().setName('watchlist').setDescription('ดู Watchlist'),
    new SlashCommandBuilder().setName('update-stock').setDescription('แก้ไขข้อมูลหุ้น').addStringOption(o => o.setName('symbol').setDescription('ชื่อหุ้น').setRequired(true)).addNumberOption(o => o.setName('amount').setDescription('จำนวน').setRequired(true)).addNumberOption(o => o.setName('avg_price').setDescription('ราคาเฉลี่ย').setRequired(true)),
    new SlashCommandBuilder().setName('history').setDescription('ดูประวัติรายการ'),
    new SlashCommandBuilder().setName('analyze-portfolio').setDescription('วิเคราะห์พอร์ตละเอียด'),
    new SlashCommandBuilder().setName('ask').setDescription('ถามคำถาม AI').addStringOption(o => o.setName('question').setDescription('คำถาม').setRequired(true)),
    new SlashCommandBuilder().setName('discover').setDescription('ค้นหาหุ้นน่าสนใจ'),
    new SlashCommandBuilder().setName('sentiment').setDescription('เช็คสภาวะตลาด'),
    new SlashCommandBuilder().setName('analyze-diversification').setDescription('วิเคราะห์การกระจายตัวพอร์ต'),
].map(cmd => cmd.toJSON());

// --- COMMAND HANDLERS ---
const handlers = {
    'stock': async (int) => {
        const sym = int.options.getString('symbol').toUpperCase();
        const q = await getStockPrice(sym);
        const analysis = await getAIAnalysis(`วิเคราะห์หุ้น ${sym} ราคา $${q.price} ข่าว: ${await getStockNews(sym)}`);
        await sendEmbed(int, `📈 Analysis: ${sym}`, `**Price:** $${q.price}\n\n${analysis}`);
    },
    'add-stock': async (int) => {
        const [s, a, p] = [int.options.getString('symbol').toUpperCase(), int.options.getNumber('amount'), int.options.getNumber('avg_price')];
        let stock = await Watchlist.findOne({ userId: int.user.id, symbol: s });
        if (stock) {
            stock.avgPrice = ((stock.amount * stock.avgPrice) + (a * p)) / (stock.amount + a);
            stock.amount += a;
            await stock.save();
        } else await Watchlist.create({ userId: int.user.id, symbol: s, amount: a, avgPrice: p });
        await Transaction.create({ userId: int.user.id, symbol: s, type: 'BUY', amount: a, price: p });
        await int.editReply(`✅ เพิ่มหุ้น **${s}** เรียบร้อย!`);
    },
    'remove-stock': async (int) => {
        const s = int.options.getString('symbol').toUpperCase();
        const res = await Watchlist.deleteOne({ userId: int.user.id, symbol: s });
        await int.editReply(res.deletedCount ? `🗑️ ลบหุ้น **${s}** เรียบร้อย` : `❌ ไม่พบหุ้น **${s}**`);
    },
    'watchlist': async (int) => {
        const stocks = await Watchlist.find({ userId: int.user.id });
        if (!stocks.length) return int.editReply("📭 พอร์ตว่างเปล่า");
        let total = 0;
        const res = await Promise.all(stocks.map(async s => {
            try {
                const q = await getStockPrice(s.symbol);
                const p = (q.price - s.avgPrice) * s.amount;
                total += p;
                return `${p >= 0 ? '🟢' : '🔴'} **${s.symbol}**: $${q.price.toFixed(2)} (P/L: $${p.toFixed(2)})`;
            } catch { return `⚪ **${s.symbol}**: N/A`; }
        }));
        await sendEmbed(int, "My Watchlist", `📊 **Overview**\n${res.join('\n')}\n\n💰 **Total P/L: $${total.toFixed(2)}**`, 0xFFA500);
    },
    'update-stock': async (int) => {
        const [s, a, p] = [int.options.getString('symbol').toUpperCase(), int.options.getNumber('amount'), int.options.getNumber('avg_price')];
        const stock = await Watchlist.findOneAndUpdate({ userId: int.user.id, symbol: s }, { amount: a, avgPrice: p });
        await int.editReply(stock ? `✅ อัปเดตหุ้น **${s}** เรียบร้อย!` : `❌ ไม่พบหุ้น **${s}**`);
    },
    'history': async (int) => {
        const logs = await Transaction.find({ userId: int.user.id }).sort({ _id: -1 }).limit(10);
        if (!logs.length) return int.editReply("📭 ไม่มีประวัติ");
        const text = logs.map(l => `🔹 **${l.type}** ${l.symbol} | ${l.amount} หุ้น | $${l.price}`).join('\n');
        await int.editReply(`📜 **ประวัติ 10 รายการล่าสุด**\n${text}`);
    },
    'analyze-portfolio': async (int) => {
        const stocks = await Watchlist.find({ userId: int.user.id });
        if (!stocks.length) return int.editReply("📭 พอร์ตว่างเปล่า");
        const data = await Promise.all(stocks.map(async s => {
            try {
                const [q, n] = await Promise.all([getStockPrice(s.symbol), getStockNews(s.symbol)]);
                return { symbol: s.symbol, profit: (q.price - s.avgPrice).toFixed(2), news: n };
            } catch { return { symbol: s.symbol, profit: 'N/A', news: 'N/A' }; }
        }));
        await sendEmbed(int, "🤖 AI Strategic Analysis", await getAIAnalysis(`วิเคราะห์พอร์ต: ${JSON.stringify(data)}`), 0x00FF00);
    },
    'ask': async (int) => sendEmbed(int, "💬 AI Q&A", await getAIAnalysis(`คำถาม: ${int.options.getString('question')}`)),
    'discover': async (int) => sendEmbed(int, "🌟 AI Discovery", await getAIAnalysis("แนะนำหุ้นเด่น 3 ตัววันนี้"), 0x9B59B6),
    'sentiment': async (int) => {
        const s = await getMarketSentiment();
        if (!s) return int.editReply("❌ ดึงข้อมูลไม่ได้");
        await sendEmbed(int, "🌡️ Market Sentiment", `**Stock:** ${s.stock.score} (${s.stock.rating})\n**Crypto:** ${s.crypto.score} (${s.crypto.rating})`, 0xFFFF00);
    },
    'analyze-diversification': async (int) => {
        const stocks = await Watchlist.find({ userId: int.user.id });
        if (!stocks.length) return int.editReply("📭 พอร์ตว่างเปล่า");
        let [total, alloc, syms] = [0, {}, {}];
        const results = await Promise.all(stocks.map(async s => {
            try {
                const [q, p] = await Promise.all([getStockPrice(s.symbol), getStockProfile(s.symbol)]);
                return { symbol: s.symbol, sector: p.sector, val: q.price * s.amount };
            } catch { return null; }
        }));
        results.filter(Boolean).forEach(r => {
            alloc[r.sector] = (alloc[r.sector] || 0) + r.val;
            syms[r.sector] = [...(syms[r.sector] || []), r.symbol];
            total += r.val;
        });
        const text = Object.keys(alloc).map(sec => `- **${sec}:** ${(alloc[sec]/total*100).toFixed(2)}% (${syms[sec].join(', ')})`).join('\n');
        await sendEmbed(int, "🧩 Diversification", `📈 **Allocation:**\n${text}\n\n🕵️ **AI:**\n${await getAIAnalysis(`วิเคราะห์กระจายความเสี่ยง: ${JSON.stringify(alloc)}`)}`, 0x3498DB);
    }
};

// --- SCHEDULED JOBS ---
const broadcast = async (userId, msg) => {
    try { (await client.users.fetch(userId)).send(msg); } catch (e) { console.error(`Failed to DM ${userId}`); }
};

// 0. Self-Ping เพื่อกันบอทหลับ (ทุก 14 นาที)
cron.schedule('*/14 * * * *', async () => {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
    try {
        await axios.get(url);
        console.log('💤 Self-ping: Keeping the engine warm...');
    } catch (e) { console.error('Self-ping failed:', e.message); }
});

// Alert price change > 3%
cron.schedule('*/30 * * * 1-5', async () => {
    const stocks = await Watchlist.find({});
    for (const s of stocks) {
        try {
            const q = await getStockPrice(s.symbol);
            const change = ((q.price - q.previousClose) / q.previousClose * 100);
            if (Math.abs(change) >= 3) {
                const analysis = await getAIAnalysis(`วิเคราะห์ด่วน: ${s.symbol} ขยับแรง ${change.toFixed(2)}% ข่าว: ${await getStockNews(s.symbol)} สรุปสั้นๆ`);
                await broadcast(s.userId, `📢 **AI Alert: ${s.symbol}**\n${analysis}`);
            }
        } catch (e) {}
    }
}, { timezone: "Asia/Bangkok" });

// Daily Pulse
cron.schedule('30 21 * * 1-5', async () => {
    const trends = [];
    for (const s of MARKET_LEADERS.slice(0, 5)) {
        try {
            const q = await getStockPrice(s);
            trends.push({ symbol: s, change: ((q.price - q.previousClose) / q.previousClose * 100) });
        } catch {}
    }
    const insight = await getAIAnalysis(`หุ้นเด่นคืนนี้: ${JSON.stringify(trends)} แนะนำ 1 ตัว`);
    const users = await Watchlist.distinct('userId');
    users.forEach(id => broadcast(id, `🌟 **Daily Market Pulse**\n\n${insight}`));
}, { timezone: "Asia/Bangkok" });

// Morning Brief
cron.schedule('30 20 * * 1-5', async () => {
    const users = await Watchlist.distinct('userId');
    for (const id of users) {
        const stocks = await Watchlist.find({ userId: id });
        if (!stocks.length) continue;
        const news = await Promise.all(stocks.map(async s => ({ symbol: s.symbol, news: await getStockNews(s.symbol) })));
        broadcast(id, `🌅 **Morning Brief**\n\n${await getAIAnalysis(`สรุปข่าวพอร์ตคืนนี้: ${JSON.stringify(news)}`)}`);
    }
}, { timezone: "Asia/Bangkok" });

// --- EVENT HANDLERS ---
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    try {
        await interaction.deferReply();
        const handler = handlers[interaction.commandName];
        if (handler) await handler(interaction);
    } catch (err) {
        console.error(err);
        const msg = err.message.includes('Price unavailable') ? `❌ ไม่พบข้อมูลหุ้น` : "❌ เกิดข้อผิดพลาดเทคนิค";
        await interaction.editReply(msg).catch(() => interaction.reply({ content: msg, ephemeral: true }));
    }
});

const start = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI.trim());
        client.once(Events.ClientReady, async (c) => {
            console.log(`✅ Online as: ${c.user.tag}`);
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN.replace(/["']/g, '').trim());
            await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        });
        await client.login(process.env.DISCORD_TOKEN.replace(/["']/g, '').trim());
    } catch (err) { console.error('BOOT ERROR:', err.message); }
};

app.get('/', (req, res) => res.send('AI Alpha is Live!'));
app.listen(port, '0.0.0.0', () => start());
