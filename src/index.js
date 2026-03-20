const express = require('express');
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// --- SETUP SERVER ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('AI Alpha Bot is running!'));
app.get('/health', (req, res) => res.status(200).send('OK'));

const server = app.listen(port, () => {
    console.log(`🌍 Server is listening on port ${port}`);
});

// --- DATABASE CONNECTION ---
async function connectDB() {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error("MONGODB_URI is not defined in environment variables");
        }
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000 // ให้รอแค่ 5 วินาทีพอ ถ้าไม่ได้ให้ Error เลย
        });
        console.log("✅ MongoDB Connected Successfully");
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err.message);
        // ไม่สั่ง process.exit เพื่อให้ Server ยังรันอยู่ Render จะได้ไม่ขึ้น Timed Out
    }
}

connectDB();

// --- DISCORD CLIENT SETUP ---
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
const MODEL_NAME = "gemini-2.0-flash";

// ... (rest of the code remains the same) ...

// --- BOT EVENTS & COMMANDS ---

client.once('ready', () => {
    console.log(`🤖 AI Bot Ready: ${client.user.tag}`);
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