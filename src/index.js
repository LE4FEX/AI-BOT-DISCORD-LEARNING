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

// --- 🛠️ ฟังก์ชัน "นักสืบ" (หาไฟล์ให้เจอ ไม่ว่าชื่อจะเป็นตัวเล็กหรือใหญ่) ---
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
            // ค้นหาไฟล์ที่ชื่อตรงกัน (แบบไม่สนใจตัวเล็ก-ใหญ่)
            const foundFile = files.find(f => f.toLowerCase() === targetFile.toLowerCase() + '.js');
            if (foundFile) {
                const fullPath = path.join(dir, foundFile);
                console.log(`✅ Smart Found: ${fullPath}`);
                return require(fullPath);
            }
        }
    }
    
    // ถ้ายังไม่เจอ ให้ลิสต์ไฟล์ทั้งหมดออกมาประจานเลยครับว่ามีอะไรบ้าง
    console.error(`❌ Search failed for: ${targetFile}`);
    console.error(`📂 Root content: ${fs.readdirSync(process.cwd()).join(', ')}`);
    throw new Error(`Module ${targetFile} หายไปไหนไม่รู้ใน GitHub!`);
}

// เรียกใช้แบบไม่ต้องกังวลเรื่องตัวเล็ก-ใหญ่
const Watchlist = smartRequire('watchlist');
const Transaction = smartRequire('transaction');

// --- 🤖 ส่วนของ Discord & AI (เหมือนเดิม) ---
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const commands = [
    new SlashCommandBuilder().setName('stock').setDescription('เช็คราคาหุ้นและวิเคราะห์').addStringOption(o => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)),
    new SlashCommandBuilder().setName('watchlist').setDescription('ดูหุ้นทั้งหมดในพอร์ต')
].map(cmd => cmd.toJSON());

async function deployCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Commands Registered');
    } catch (e) { console.error('❌ Sync Error:', e); }
}

client.once(Events.ClientReady, c => console.log(`✅✅✅ BOT ONLINE: ${c.user.tag}`));

// --- 🚀 เริ่มระบบ ---
async function start() {
    try {
        console.log('--- 🚀 Starting Services Verification ---');
        
        // 1. ตรวจสอบ Environment Variables เบื้องต้น (ไม่โชว์ Token จริงเพื่อความปลอดภัย)
        console.log(`📡 Checking Env Vars: TOKEN=${process.env.DISCORD_TOKEN ? 'YES' : 'NO'}, CLIENT=${process.env.CLIENT_ID ? 'YES' : 'NO'}`);

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ DB Connected Successfully');

        // 2. บังคับ Login
        if (process.env.DISCORD_TOKEN) {
            console.log('🔐 Attempting Discord Login... (Waiting for Discord response)');
            
            // ตั้ง Timeout ถ้า Discord ไม่ตอบใน 10 วินาทีให้แจ้งเตือน
            const loginTimeout = setTimeout(() => {
                console.error('⚠️ Login is taking too long... checking connection');
            }, 10000);

            await client.login(process.env.DISCORD_TOKEN);
            clearTimeout(loginTimeout);
            
            console.log(`✅✅✅ BOT IS NOW ONLINE AS: ${client.user.tag}`);
            deployCommands(); 
        } else {
            console.error('❌ CRITICAL ERROR: DISCORD_TOKEN is completely missing from Render Settings!');
        }
    } catch (err) {
        console.error('❌ BOOT ERROR:', err.message);
        console.error(err.stack); // โชว์จุดที่ Error อย่างละเอียด
    }
}

app.get('/', (req, res) => res.send('Bot is Live'));
app.listen(port, () => console.log(`🌍 Server active on ${port}`));
start();