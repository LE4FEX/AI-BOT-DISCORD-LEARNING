const express = require('express');
const path = require('path');
const fs = require('fs');
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- 🛠️ ฟังก์ชัน "นักสืบ" (คงไว้เพราะทำงานได้ดีแล้ว) ---
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

// --- 🤖 ปรับแต่ง Client ตามรูปภาพที่คุณส่งมา (เปิดครบ 5 ตัวที่จำเป็น) ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, //
        GatewayIntentBits.GuildMembers,   //
        GatewayIntentBits.GuildPresences  //
    ] 
});

const commands = [
    new SlashCommandBuilder()
        .setName('stock')
        .setDescription('เช็คราคาหุ้นและวิเคราะห์ด้วย AI')
        .addStringOption(option => 
            option.setName('symbol')
                .setDescription('ใส่ชื่อหุ้นที่ต้องการ (เช่น TSLA, NVDA)') // <--- ห้ามลืมบรรทัดนี้!
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

// --- 🚀 เริ่มระบบ (ปรับปรุงใหม่เพื่อความเสถียรบน Render) ---
async function start() {
    try {
        console.log('--- 🚀 Starting Jarvis Services ---');
        
        // 1. ตรวจสอบและทำความสะอาด Environment Variables
        const rawToken = process.env.DISCORD_TOKEN;
        const rawMongo = process.env.MONGODB_URI;

        if (!rawToken) throw new Error('❌ Missing DISCORD_TOKEN');
        if (!rawMongo) throw new Error('❌ Missing MONGODB_URI');

        // ขจัดช่องว่างหรืออัญประกาศที่อาจติดมาจากการ Copy-Paste
        const cleanToken = rawToken.replace(/["']/g, '').trim();
        const cleanMongo = rawMongo.trim();

        // 2. เชื่อมต่อ Database
        console.log('⏳ Connecting to MongoDB...');
        await mongoose.connect(cleanMongo);
        console.log('✅ DB Connected Successfully');

        // 3. ตั้งค่า Client Events
        client.once(Events.ClientReady, async (c) => {
            console.log('******************************************');
            console.log(`✅ SUCCESS! Jarvis is Online as: ${c.user.tag}`);
            console.log('******************************************');
            await deployCommands(); 
        });

        client.on(Events.Error, (error) => {
            console.error('❌ Discord Client Error:', error);
        });

        // เปิด Debug ชั่วคราวเพื่อดูว่าทำไมถึงค้าง (ถ้า Online แล้วให้ลบออกได้)
        client.on('debug', (info) => {
            if (info.includes('Session')) console.log(`ℹ️ [Discord Debug] ${info}`);
        });

        // 4. เริ่มการ Login
        console.log('🔐 Attempting Discord Login...');
        try {
            await client.login(cleanToken);
        } catch (loginErr) {
            if (loginErr.message.includes('PRIVILEGED_INTENTS')) {
                console.error('❌ ERROR: คุณยังไม่ได้เปิด Privileged Intents ใน Discord Developer Portal!');
                console.error('👉 วิธีแก้: ไปที่ Bot -> Privileged Gateway Intents แล้วเปิดให้ครบ 3 ตัวครับ');
            } else {
                console.error('❌ LOGIN FAILED:', loginErr.message);
            }
            // ไม่ต้อง process.exit เพื่อให้ Server ของ Express ยังรันอยู่ให้เราดู Log ได้
        }

    } catch (err) {
        console.error('❌ BOOT ERROR:', err.message);
    }
}

// ส่วนของ Web Server สำหรับ Render
app.get('/', (req, res) => res.status(200).send('Jarvis is Live and Running!'));

// รัน Express ก่อนเพื่อให้ผ่าน Health Check ของ Render ทันที
app.listen(port, '0.0.0.0', () => {
    console.log(`🌍 Health Check Server active on port ${port}`);
    console.log('🛰️ System is ready, starting bot sequence...');
    start(); 
});