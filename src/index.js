const express = require('express');
const path = require('path');
const fs = require('fs');
const { Client, GatewayIntentBits, Events, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = 8000;
const FALLBACK_SECTOR = 'Unknown';

// --- ฟังก์ชันดึง Model แบบพิเศษ (แก้ปัญหา Path บน Render) ---
function getModel(folder, file) {
    // 1. ลองหาจาก Root (ใช้สำหรับโครงสร้างมาตรฐาน)
    const rootPath = path.join(process.cwd(), folder, file);
    // 2. ลองหาแบบถอยหลังจาก src (ใช้เมื่อรันจากภายใน src)
    const relativePath = path.join(__dirname, '..', folder, file);
    
    if (fs.existsSync(rootPath + '.js') || fs.existsSync(rootPath)) {
        console.log(`✅ Found ${file} at Root: ${rootPath}`);
        return require(rootPath);
    } else if (fs.existsSync(relativePath + '.js') || fs.existsSync(relativePath)) {
        console.log(`✅ Found ${file} via Relative: ${relativePath}`);
        return require(relativePath);
    } else {
        // ถ้าไม่เจอ ให้ List ไฟล์ใน Root ออกมาดูเพื่อ Debug ผ่านหน้า Logs ของ Render
        const rootContent = fs.existsSync(process.cwd()) ? fs.readdirSync(process.cwd()) : 'Directory not found';
        console.error(`❌ Module Not Found: ${file}. Available in root:`, rootContent);
        throw new Error(`Cannot find module '${file}' in '${folder}' folder.`);
    }
}

// ถ้าโฟลเดอร์ models อยู่ใน src เหมือนกับ index.js ให้ใช้แบบนี้ครับ
const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');

// ตั้งค่า Gemini
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

// --- Slash Commands Definition ---
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
].map(cmd => cmd.toJSON());

// --- Core Functions ---
async function deployCommands() {
    if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
        return console.error('❌ Cannot deploy commands: Missing TOKEN or CLIENT_ID');
    }
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('⏳ Refreshing Slash Commands...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Slash Commands Synchronized');
    } catch (error) { console.error('❌ Command Error:', error); }
}

async function connectDB() {
    try {
        if (!process.env.MONGODB_URI) throw new Error('Missing MONGODB_URI');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB Connected Successfully');
    } catch (err) { console.error('❌ DB Connection Error:', err.message); }
}

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

// --- Helper Functions ---
async function httpGet(url) { return axios.get(url, { timeout: REQUEST_TIMEOUT_MS }); }

async function getStockPrice(symbol) {
    const { data } = await httpGet(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol.toUpperCase()}?interval=1d&range=1d`);
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('Stock not found');
    return { symbol: symbol.toUpperCase(), price: result.meta.regularMarketPrice };
}

async function getAIAnalysis(prompt) {
    if (!genAI) return '⚠️ AI Service not configured (Missing API Key)';
    try {
        const model = genAI.getGenerativeModel({ model: MODEL_NAME });
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) { return '❌ AI Error: ' + e.message; }
}

// --- Bot Events ---
client.once(Events.ClientReady, c => {
    console.log(`🤖 Bot Online! Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    try {
        await interaction.deferReply();

        if (interaction.commandName === 'stock') {
            const sym = interaction.options.getString('symbol').toUpperCase();
            const q = await getStockPrice(sym);
            const ai = await getAIAnalysis(`วิเคราะห์แนวโน้มหุ้น ${sym} ที่ราคา $${q.price} แบบสั้นๆ`);
            const embed = new EmbedBuilder()
                .setTitle(`📈 ข้อมูลหุ้น: ${sym}`)
                .setDescription(`**ราคาปัจจุบัน:** $${q.price}\n\n**AI Analysis:**\n${ai}`)
                .setColor(0x2ECC71)
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        }
        else if (interaction.commandName === 'watchlist') {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (!stocks || stocks.length === 0) return interaction.editReply('📭 คุณยังไม่มีหุ้นในพอร์ต ใช้ `/add-stock` เพื่อเพิ่มหุ้นครับ');
            
            const rows = await Promise.all(stocks.map(async s => {
                const q = await getStockPrice(s.symbol).catch(() => ({ price: 0 }));
                const profit = ((q.price - s.avgPrice) * s.amount).toFixed(2);
                return `**${s.symbol}**: $${q.price} (P/L: $${profit})`;
            }));
            
            const embed = new EmbedBuilder()
                .setTitle('📋 My Watchlist')
                .setDescription(rows.join('\n'))
                .setColor(0xFFA500);
            await interaction.editReply({ embeds: [embed] });
        }
        else if (interaction.commandName === 'add-stock') {
            const sym = interaction.options.getString('symbol').toUpperCase();
            const amt = interaction.options.getNumber('amount');
            const avg = interaction.options.getNumber('avg_price');

            await Watchlist.findOneAndUpdate(
                { userId: interaction.user.id, symbol: sym },
                { amount: amt, avgPrice: avg },
                { upsert: true }
            );
            
            // บันทึกประวัติ
            await Transaction.create({ userId: interaction.user.id, symbol: sym, type: 'BUY', amount: amt, price: avg });
            
            await interaction.editReply(`✅ บันทึกหุ้น **${sym}** จำนวน ${amt} หุ้น ที่ราคา $${avg} เรียบร้อย!`);
        }
        // ... คำสั่งอื่นๆ สามารถก๊อปปี้ Logic เดิมมาวางเพิ่มได้ครับ ...
        
    } catch (err) {
        console.error('Command Error:', err);
        const errorMsg = err.message.includes('Stock not found') ? '❌ ไม่พบชื่อหุ้นนี้' : '❌ เกิดข้อผิดพลาด: ' + err.message;
        if (interaction.deferred) await interaction.editReply(errorMsg);
    }
});

// --- Start Services ---
async function start() {
    await connectDB();
    await deployCommands();
    if (process.env.DISCORD_TOKEN) {
        console.log(`🔐 Attempting login with token: ...${process.env.DISCORD_TOKEN.slice(-4)}`);
        client.login(process.env.DISCORD_TOKEN).catch(err => console.error('❌ Login Failed:', err.message));
    } else {
        console.error('❌ DISCORD_TOKEN is missing in Environment Variables!');
    }
}

// Keep-alive server
app.get('/', (req, res) => res.send('AI Alpha Bot is running!'));
app.listen(port, () => console.log(`🌍 Web Server active on port ${port}`));

start();