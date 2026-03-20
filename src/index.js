const express = require('express');
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_EMBED_DESCRIPTION_LENGTH = 4000;
const FALLBACK_SECTOR = 'Unknown';

const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');

const genAI = process.env.GEMINI_API_KEY
    ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    : null;
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

app.get('/', (req, res) => res.send('AI Alpha Bot is running!'));
app.get('/health', (req, res) => {
    const mongoReadyState = mongoose.connection.readyState;
    const discordReady = client.isReady();

    res.status(200).json({
        ok: true,
        mongoReadyState,
        discordReady,
        uptimeSeconds: Math.floor(process.uptime())
    });
});

const server = app.listen(port, () => {
    console.log(`🌍 Server is listening on port ${port}`);
});

async function connectDB() {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not defined in environment variables');
        }

        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        console.log('✅ MongoDB Connected Successfully');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

function truncateText(text, maxLength = MAX_EMBED_DESCRIPTION_LENGTH) {
    if (!text) return 'ไม่มีข้อมูลเพิ่มเติมในขณะนี้';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
}

async function httpGet(url, config = {}) {
    return axios.get(url, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
            'User-Agent': 'AI-Alpha-Bot/1.0',
            Accept: 'application/json, text/plain, */*',
            ...config.headers,
        },
        ...config,
    });
}

async function getStockPrice(symbol) {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalizedSymbol)}?interval=1d&range=1d`;
    const { data } = await httpGet(url);
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    const price = meta?.regularMarketPrice ?? meta?.previousClose;

    if (typeof price !== 'number') {
        throw new Error(`Unable to get price for ${normalizedSymbol}`);
    }

    return {
        symbol: normalizedSymbol,
        price,
        currency: meta?.currency || 'USD',
        exchangeName: meta?.exchangeName || 'Unknown',
    };
}

async function getStockProfile(symbol) {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(normalizedSymbol)}?modules=assetProfile`; 
    const { data } = await httpGet(url);
    const profile = data?.quoteSummary?.result?.[0]?.assetProfile;

    return {
        sector: profile?.sector || FALLBACK_SECTOR,
        industry: profile?.industry || 'Unknown',
        summary: profile?.longBusinessSummary || 'No profile summary available.',
    };
}

async function getStockNews(symbol) {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(normalizedSymbol)}&quotesCount=1&newsCount=3`;
    const { data } = await httpGet(searchUrl);
    const articles = Array.isArray(data?.news) ? data.news.slice(0, 3) : [];

    if (articles.length === 0) {
        return 'ยังไม่พบข่าวล่าสุดที่ใช้งานได้ในขณะนี้';
    }

    return articles
        .map((article, index) => `${index + 1}. ${article.title}`)
        .join('\n');
}

async function getMarketSentiment() {
    const [stockResponse, cryptoResponse] = await Promise.all([
        httpGet('https://api.alternative.me/fng/?limit=1'),
        httpGet('https://api.coinmarketcap.com/data-api/v3/fear-and-greed/historical?limit=1')
    ]);

    const stockItem = stockResponse.data?.data?.[0];
    const cryptoItem = cryptoResponse.data?.data?.[0];

    if (!stockItem && !cryptoItem) {
        return null;
    }

    return {
        stock: {
            score: stockItem?.value || 'N/A',
            rating: stockItem?.value_classification || 'Unavailable',
        },
        crypto: {
            score: cryptoItem?.value || 'N/A',
            rating: cryptoItem?.value_classification || 'Unavailable',
        }
    };
}

async function getAIAnalysis(prompt) {
    if (!genAI) {
        return '⚠️ ยังไม่ได้ตั้งค่า GEMINI_API_KEY จึงไม่สามารถวิเคราะห์ด้วย AI ได้ในตอนนี้';
    }

    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.();

    return text || 'ไม่สามารถสร้างบทวิเคราะห์ได้ในขณะนี้';
}

async function sendEmbedResponse(interaction, title, description, color = 0x2ECC71) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(truncateText(description))
        .setColor(color)
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

async function startServices() {
    await connectDB();

    if (!process.env.DISCORD_TOKEN) {
        console.error('❌ DISCORD_TOKEN is not defined. Discord bot login skipped.');
        return;
    }

    try {
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('❌ Discord login failed:', error.message);
    }
}

client.once(Events.ClientReady, readyClient => {
    console.log(`🤖 AI Bot Ready: ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        if (interaction.commandName === 'analyze-portfolio') {
            await interaction.deferReply();
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply('📭 พอร์ตว่างเปล่าครับ');

            const portfolioData = await Promise.all(stocks.map(async stockItem => {
                try {
                    const [quote, news] = await Promise.all([
                        getStockPrice(stockItem.symbol),
                        getStockNews(stockItem.symbol)
                    ]);
                    const totalProfit = (quote.price - stockItem.avgPrice) * stockItem.amount;

                    return {
                        symbol: stockItem.symbol,
                        shares: stockItem.amount,
                        avgPrice: stockItem.avgPrice,
                        currentPrice: quote.price,
                        profit: totalProfit.toFixed(2),
                        news,
                    };
                } catch (error) {
                    return { symbol: stockItem.symbol, error: 'Price/News unavailable' };
                }
            }));

            const analysis = await getAIAnalysis(`วิเคราะห์พอร์ตลงทุนปัจจุบัน (JSON Format): ${JSON.stringify(portfolioData)}\nกรุณาให้คำแนะนำเชิงกลยุทธ์แบบมืออาชีพ โดยอ้างอิงจากราคาปัจจุบันและข่าวสารที่เกิดขึ้น`);
            await sendEmbedResponse(interaction, '🤖 AI Strategic Analysis', analysis, 0x00FF00);
        } else if (interaction.commandName === 'watchlist') {
            await interaction.deferReply();
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply('📭 พอร์ตว่างเปล่าครับ');

            const results = await Promise.all(stocks.map(async stockItem => {
                try {
                    const quote = await getStockPrice(stockItem.symbol);
                    const profit = (quote.price - stockItem.avgPrice) * stockItem.amount;
                    return {
                        text: `${profit >= 0 ? '🟢' : '🔴'} **${stockItem.symbol}**: $${quote.price.toFixed(2)} (P/L: $${profit.toFixed(2)})`,
                        profit,
                    };
                } catch (error) {
                    return { text: `⚪ **${stockItem.symbol}**: N/A`, profit: 0 };
                }
            }));

            const total = results.reduce((sum, result) => sum + result.profit, 0);
            const resultText = results.map(result => result.text).join('\n');
            await sendEmbedResponse(interaction, 'My Watchlist', `📊 **Overview**\n${resultText}\n\n💰 **Total P/L: $${total.toFixed(2)}**`, 0xFFA500);
        } else if (interaction.commandName === 'analyze-diversification') {
            await interaction.deferReply();
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply('📭 พอร์ตว่างเปล่าครับ');

            const sectorAllocation = {};
            const sectorStocks = {};
            let totalValue = 0;

            const results = await Promise.all(stocks.map(async stockItem => {
                try {
                    const [quote, profile] = await Promise.all([
                        getStockPrice(stockItem.symbol),
                        getStockProfile(stockItem.symbol)
                    ]);
                    return {
                        symbol: stockItem.symbol,
                        sector: profile.sector || FALLBACK_SECTOR,
                        value: quote.price * stockItem.amount,
                    };
                } catch (error) {
                    return null;
                }
            }));

            results.forEach(result => {
                if (!result) return;
                sectorAllocation[result.sector] = (sectorAllocation[result.sector] || 0) + result.value;
                sectorStocks[result.sector] = sectorStocks[result.sector] || [];
                sectorStocks[result.sector].push(result.symbol);
                totalValue += result.value;
            });

            if (totalValue === 0) {
                return await interaction.editReply('❌ ยังไม่สามารถคำนวณการกระจายความเสี่ยงได้ในขณะนี้');
            }

            const allocationText = Object.keys(sectorAllocation)
                .map(sector => {
                    const percentage = (sectorAllocation[sector] / totalValue * 100).toFixed(2);
                    return `- **${sector}:** ${percentage}% (${sectorStocks[sector].join(', ')})`;
                })
                .join('\n');

            const analysis = await getAIAnalysis(`วิเคราะห์การกระจายความเสี่ยง: ${JSON.stringify(sectorAllocation)}`);
            await sendEmbedResponse(interaction, '🧩 Portfolio Diversification', `📈 **Allocation:**\n${allocationText}\n\n🕵️ **AI Analysis:**\n${analysis}`, 0x3498DB);
        } else if (interaction.commandName === 'update-stock') {
            await interaction.deferReply();
            const symbol = interaction.options.getString('symbol').toUpperCase();
            const amount = interaction.options.getNumber('amount');
            const avgPrice = interaction.options.getNumber('avg_price');

            const stock = await Watchlist.findOne({ userId: interaction.user.id, symbol });
            if (!stock) return await interaction.editReply(`❌ ไม่พบหุ้น **${symbol}** ในพอร์ต`);

            stock.amount = amount;
            stock.avgPrice = avgPrice;
            await stock.save();
            await Transaction.create({ userId: interaction.user.id, symbol, type: 'UPDATE', amount, price: avgPrice });
            await interaction.editReply(`✅ อัปเดตหุ้น **${symbol}** เป็น ${amount} หุ้น ที่ราคาเฉลี่ย $${avgPrice} เรียบร้อย!`);
        } else if (interaction.commandName === 'add-stock') {
            await interaction.deferReply();
            const symbol = interaction.options.getString('symbol').toUpperCase();
            const amount = interaction.options.getNumber('amount');
            const avgPrice = interaction.options.getNumber('avg_price');

            const stock = await Watchlist.findOne({ userId: interaction.user.id, symbol });
            if (stock) {
                stock.avgPrice = ((stock.amount * stock.avgPrice) + (amount * avgPrice)) / (stock.amount + amount);
                stock.amount += amount;
                await stock.save();
            } else {
                await Watchlist.create({ userId: interaction.user.id, symbol, amount, avgPrice });
            }

            await Transaction.create({ userId: interaction.user.id, symbol, type: 'BUY', amount, price: avgPrice });
            await interaction.editReply(`✅ เพิ่มหุ้น **${symbol}** เข้าพอร์ตเรียบร้อย!`);
        } else if (interaction.commandName === 'stock') {
            await interaction.deferReply();
            const symbol = interaction.options.getString('symbol').toUpperCase();
            const [quote, news] = await Promise.all([
                getStockPrice(symbol),
                getStockNews(symbol)
            ]);
            const analysis = await getAIAnalysis(`วิเคราะห์หุ้น ${symbol} ราคา $${quote.price} ข่าว: ${news}`);
            await sendEmbedResponse(interaction, `📈 Analysis: ${symbol}`, `**Price:** $${quote.price}\n\n${analysis}`);
        } else if (interaction.commandName === 'ask') {
            await interaction.deferReply();
            const question = interaction.options.getString('question');
            const analysis = await getAIAnalysis(`ผู้ใช้ถามว่า: ${question}`);
            await sendEmbedResponse(interaction, '💬 AI Q&A', analysis);
        } else if (interaction.commandName === 'remove-stock') {
            await interaction.deferReply();
            const symbol = interaction.options.getString('symbol').toUpperCase();
            const result = await Watchlist.deleteOne({ userId: interaction.user.id, symbol });

            if (result.deletedCount > 0) {
                await interaction.editReply(`🗑️ ลบหุ้น **${symbol}** ออกจากพอร์ตเรียบร้อยแล้ว`);
            } else {
                await interaction.editReply(`❌ ไม่พบหุ้น **${symbol}** ในพอร์ตของคุณ`);
            }
        } else if (interaction.commandName === 'sentiment') {
            await interaction.deferReply();
            const sentiment = await getMarketSentiment();
            if (!sentiment) return await interaction.editReply('❌ ไม่สามารถดึงข้อมูลสภาวะตลาดได้ในขณะนี้');

            const message = `**Stock Market (Fear & Greed):** ${sentiment.stock.score} (${sentiment.stock.rating})\n**Crypto Market:** ${sentiment.crypto.score} (${sentiment.crypto.rating})`;
            await sendEmbedResponse(interaction, '🌡️ Market Sentiment', message, 0xFFFF00);
        } else if (interaction.commandName === 'discover') {
            await interaction.deferReply();
            const analysis = await getAIAnalysis('ช่วยแนะนำหุ้นเด่นที่น่าสนใจ 3 ตัวสำหรับสภาวะตลาดวันนี้ พร้อมเหตุผลประกอบสั้นๆ');
            await sendEmbedResponse(interaction, '🌟 AI Investment Discovery', analysis, 0x9B59B6);
        } else if (interaction.commandName === 'history') {
            await interaction.deferReply();
            const logs = await Transaction.find({ userId: interaction.user.id }).sort({ _id: -1 }).limit(10);
            if (logs.length === 0) return await interaction.editReply('📭 ยังไม่มีประวัติการทำรายการครับ');

            const text = logs.map(log => `🔹 **${log.type}** ${log.symbol} | ${log.amount} หุ้น | $${log.price}`).join('\n');
            await interaction.editReply(`📜 **ประวัติการทำรายการ (10 รายการล่าสุด)**\n${text}`);
        } else {
            await interaction.reply({ content: '❌ ยังไม่รองรับคำสั่งนี้', ephemeral: true });
        }
    } catch (err) {
        console.error('Command Execution Error:', err);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply('❌ เกิดข้อผิดพลาดทางเทคนิค กรุณาลองใหม่อีกครั้งครับ');
        } else {
            await interaction.reply({ content: '❌ เกิดข้อผิดพลาดทางเทคนิค กรุณาลองใหม่อีกครั้งครับ', ephemeral: true });
        }
    }
});

process.on('SIGTERM', () => {
    server.close(() => console.log('🛑 HTTP server stopped'));
    client.destroy();
});

startServices();
