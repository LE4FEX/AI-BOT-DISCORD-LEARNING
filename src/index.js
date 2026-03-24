const express = require('express');
const path = require('path');
const fs = require('fs');
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- 🛠️ ฟังก์ชัน "นักสืบ" ---
function smartRequire(targetFile) {
    const searchDirs = [
        path.join(process.cwd(), 'models'),
        path.join(process.cwd(), 'src', 'models'),
        path.join(__dirname, 'models')
    ];
    for (let dir of searchDirs) {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            const foundFile = files.find(f => f.toLowerCase() === targetFile.toLowerCase() + '.js');
            if (foundFile) return require(path.join(dir, foundFile));
        }
    }
    throw new Error(`หาไฟล์ ${targetFile} ไม่เจอครับ`);
}

const Watchlist = smartRequire('watchlist');
const Transaction = smartRequire('transaction');

// --- 🤖 ปรับแต่ง Client (ลดเหลือพื้นฐานเพื่อให้ Online ได้ง่ายที่สุด) ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages
    ] 
});

const commands = [
    new SlashCommandBuilder()
        .setName('stock')
        .setDescription('เช็คราคาหุ้นและวิเคราะห์ด้วย AI')
        .addStringOption(option => 
            option.setName('symbol')
                .setDescription('ใส่ชื่อหุ้นที่ต้องการ (เช่น TSLA, NVDA)')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('watchlist')
        .setDescription('ดูรายการหุ้นทั้งหมดในพอร์ตของคุณ')
].map(cmd => cmd.toJSON());

async function deployCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Commands Registered');
    } catch (e) { console.error('❌ Sync Error:', e.message); }
}

// --- 🚀 เริ่มระบบ ---
async function start() {
    try {
        console.log('--- 🚀 Starting Jarvis Services ---');
        
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

        // เปิด Debug logs เพื่อดูสาเหตุที่ Login ค้าง
        client.on('debug', (info) => {
            console.log(`ℹ️ [Discord Debug] ${info}`);
        });

        console.log('🔐 Attempting Discord Login...');
        await client.login(cleanToken);

    } catch (err) {
        console.error('❌ BOOT ERROR:', err.message);
    }
}

// Health Check สำหรับ Render
app.get('/', (req, res) => res.status(200).send('Jarvis is Live and Running!'));

app.listen(port, '0.0.0.0', () => {
    console.log(`🌍 Health Check Server active on port ${port}`);
    start(); 
});