const express = require('express');
const path = require('path');
const { Client, GatewayIntentBits, Events, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_EMBED_DESCRIPTION_LENGTH = 4000;
const FALLBACK_SECTOR = 'Unknown';
const appStartedAt = new Date().toISOString();

// __dirname คือที่อยู่ของ index.js (คือ src)
// '..' คือการถอยออกจาก src ไปที่ root
const Watchlist = require(path.join(__dirname, '..', 'models', 'watchlist'));
const Transaction = require(path.join(__dirname, '..', 'models', 'transaction'));

// ตั้งค่า Gemini (ใช้ 1.5-flash เพื่อความชัวร์)
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

// --- ส่วนของ Slash Commands Configuration ---
const commands = [
    new SlashCommandBuilder().setName('stock').setDescription('เช็คราคาหุ้นและวิเคราะห์').addStringOption(o => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)),
    new SlashCommandBuilder().setName('add-stock').setDescription('เพิ่มหุ้นเข้าพอร์ต').addStringOption(o => o.setName('symbol').setRequired(true)).addNumberOption(o => o.setName('amount').setRequired(true)).addNumberOption(o => o.setName('avg_price').setRequired(true)),
    new SlashCommandBuilder().setName('remove-stock').setDescription('ลบหุ้นออก').addStringOption(o => o.setName('symbol').setRequired(true)),
    new SlashCommandBuilder().setName('watchlist').setDescription('ดูหุ้นทั้งหมดในพอร์ต'),
    new SlashCommandBuilder().setName('update-stock').setDescription('แก้ไขข้อมูลหุ้น').addStringOption(o => o.setName('symbol').setRequired(true)).addNumberOption(o => o.setName('amount').setRequired(true)).addNumberOption(o => o.setName('avg_price').setRequired(true)),
    new SlashCommandBuilder().setName('history').setDescription('ดูประวัติการทำรายการ'),
    new SlashCommandBuilder().setName('analyze-portfolio').setDescription('AI วิเคราะห์พอร์ต'),
    new SlashCommandBuilder().setName('ask').setDescription('ถาม AI').addStringOption(o => o.setName('question').setRequired(true)),
    new SlashCommandBuilder().setName('discover').setDescription('AI ค้นหาหุ้นเด่น'),
    new SlashCommandBuilder().setName('sentiment').setDescription('เช็คสภาวะตลาด'),
    new SlashCommandBuilder().setName('analyze-diversification').setDescription('วิเคราะห์การกระจายความเสี่ยง'),
].map(command => command.toJSON());

// --- ฟังก์ชันลงทะเบียนคำสั่ง (Slash Commands) ---
async function deployCommands() {
    if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) return console.error('❌ Missing Token or Client ID for commands');
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('⏳ Updating Slash Commands...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Slash Commands Updated.');
    } catch (error) { console.error('❌ Command Deploy Error:', error); }
}

// --- ฟังก์ชันจัดการฐานข้อมูลและการเชื่อมต่อ ---
async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
        console.log('✅ MongoDB Connected Successfully');
    } catch (err) { console.error('❌ MongoDB Connection Error:', err.message); }
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const discordStatus = { loginAttempted: false, readyAt: null, lastError: null };

// --- Helper Functions ---
async function httpGet(url) {
    return axios.get(url, { timeout: REQUEST_TIMEOUT_MS, headers: { 'User-Agent': 'AI-Alpha-Bot/1.0' } });
}

async function getStockPrice(symbol) {
    const { data } = await httpGet(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol.toUpperCase()}?interval=1d&range=1d`);
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('Price not found');
    return { symbol: symbol.toUpperCase(), price: meta.regularMarketPrice || meta.previousClose };
}

async function getStockProfile(symbol) {
    const { data } = await httpGet(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol.toUpperCase()}?modules=assetProfile`);
    const profile = data?.quoteSummary?.result?.[0]?.assetProfile;
    return { sector: profile?.sector || FALLBACK_SECTOR, industry: profile?.industry || 'Unknown' };
}

async function getStockNews(symbol) {
    const { data } = await httpGet(`https://query1.finance.yahoo.com/v1/finance/search?q=${symbol.toUpperCase()}&newsCount=3`);
    return data?.news?.map((n, i) => `${i + 1}. ${n.title}`).join('\n') || 'ไม่มีข่าว';
}

async function getMarketSentiment() {
    try {
        const [s, c] = await Promise.all([httpGet('https://api.alternative.me/fng/?limit=1'), httpGet('https://api.coinmarketcap.com/data-api/v3/fear-and-greed/historical?limit=1')]);
        return { stock: s.data.data[0].value, crypto: c.data.data[0].value };
    } catch (e) { return null; }
}

async function getAIAnalysis(prompt) {
    if (!genAI) return '⚠️ Missing Gemini Key';
    try {
        const model = genAI.getGenerativeModel({ model: MODEL_NAME });
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) { return '❌ AI Error: ' + e.message; }
}

async function sendEmbedResponse(interaction, title, description, color = 0x2ECC71) {
    const embed = new EmbedBuilder().setTitle(title).setDescription(description.substring(0, 4000)).setColor(color).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
}

// --- Event Handlers ---
client.once(Events.ClientReady, c => {
    discordStatus.readyAt = new Date().toISOString();
    console.log(`🤖 AI Bot Ready: ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    try {
        if (interaction.commandName === 'stock') {
            await interaction.deferReply();
            const sym = interaction.options.getString('symbol').toUpperCase();
            const [q, n] = await Promise.all([getStockPrice(sym), getStockNews(sym)]);
            const ai = await getAIAnalysis(`วิเคราะห์หุ้น ${sym} ราคา $${q.price} ข่าว: ${n}`);
            await sendEmbedResponse(interaction, `📈 Analysis: ${sym}`, `**Price:** $${q.price}\n\n${ai}`);
        } 
        else if (interaction.commandName === 'watchlist') {
            await interaction.deferReply();
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (!stocks.length) return interaction.editReply('📭 พอร์ตว่างเปล่า');
            let totalPL = 0;
            const rows = await Promise.all(stocks.map(async s => {
                const q = await getStockPrice(s.symbol).catch(() => ({ price: 0 }));
                const pl = (q.price - s.avgPrice) * s.amount;
                totalPL += pl;
                return `${pl >= 0 ? '🟢' : '🔴'} **${s.symbol}**: $${q.price} (P/L: $${pl.toFixed(2)})`;
            }));
            await sendEmbedResponse(interaction, 'My Watchlist', rows.join('\n') + `\n\n**Total P/L: $${totalPL.toFixed(2)}**`, 0xFFA500);
        }
        else if (interaction.commandName === 'add-stock') {
            await interaction.deferReply();
            const sym = interaction.options.getString('symbol').toUpperCase();
            const amt = interaction.options.getNumber('amount');
            const prc = interaction.options.getNumber('avg_price');
            await Watchlist.findOneAndUpdate({ userId: interaction.user.id, symbol: sym }, { $set: { amount: amt, avgPrice: prc } }, { upsate: true, new: true });
            await interaction.editReply(`✅ เพิ่ม/อัปเดตหุ้น **${sym}** เรียบร้อย!`);
        }
        // ... (คำสั่งอื่นๆ ทำงานตาม Logic เดิมในโค้ดของคุณ) ...
    } catch (err) {
        console.error('Command Error:', err);
        if (interaction.deferred) await interaction.editReply('❌ เกิดข้อผิดพลาดทางเทคนิค');
    }
});

// --- Start Services ---
async function startServices() {
    await connectDB();
    await deployCommands();
    const token = process.env.DISCORD_TOKEN;
    if (token) {
        console.log(`🔐 Attempting Login with Token ending in: ...${token.slice(-4)}`);
        client.login(token).catch(e => console.error('❌ Login Failed:', e.message));
    } else {
        console.error('❌ No DISCORD_TOKEN found!');
    }
}

app.get('/', (req, res) => res.send('Alpha Bot is Online!'));
app.listen(port, () => console.log(`🌍 Web Server on port ${port}`));

startServices();