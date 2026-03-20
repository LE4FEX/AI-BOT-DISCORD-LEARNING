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
        console.log(`📡 Checking Env Vars: TOKEN=${process.env.DISCORD_TOKEN ? 'YES' : 'NO'}`);

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ DB Connected Successfully');

        if (process.env.DISCORD_TOKEN) {
            console.log('🔐 Attempting Discord Login...');
            
            // ดักจับ Error ตอน Login โดยตรง
            client.login(process.env.DISCORD_TOKEN).catch(err => {
                console.error('❌ DISCORD LOGIN FAILED!');
                console.error(`Reason: ${err.message}`);
                if (err.message.includes('Used disallowed intents')) console.error('👉 ไปเช็คที่ Discord Portal ว่าเปิด Intents ครบหรือยัง');
                if (err.message.includes('An invalid token was provided')) console.error('👉 Token ไม่ถูกต้องหรือถูก Reset ไปแล้ว');
            });

            // รอ Event Ready
            client.once('ready', () => {
                console.log(`✅✅✅ SUCCESS! BOT ONLINE AS: ${client.user.tag}`);
                deployCommands();
            });

        } else {
            console.error('❌ DISCORD_TOKEN is missing');
        }
    } catch (err) {
        console.error('❌ BOOT ERROR:', err.message);
    }
}

app.get('/', (req, res) => res.send('Bot is Live'));
app.listen(port, () => console.log(`🌍 Server active on ${port}`));
start();