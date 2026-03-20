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

// --- 🛠️ ฟังก์ชัน "นักสืบ" (เหมือนเดิม) ---
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
            if (foundFile) {
                const fullPath = path.join(dir, foundFile);
                console.log(`✅ Smart Found: ${fullPath}`);
                return require(fullPath);
            }
        }
    }
    console.error(`❌ Search failed for: ${targetFile}`);
    throw new Error(`Module ${targetFile} not found.`);
}

const Watchlist = smartRequire('watchlist');
const Transaction = smartRequire('transaction');

// --- 🤖 ปรับแต่ง Discord Client (เพิ่ม Intents และระบบ Debug) ---
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,   // เพิ่มให้ตรงกับ Portal
        GatewayIntentBits.GuildPresences  // เพิ่มให้ตรงกับ Portal
    ] 
});

// ระบบสืบสวน (Debug) - จะช่วยบอกว่าบอทคุยอะไรกับ Discord บ้าง
client.on('debug', info => {
    if (info.includes('Session') || info.includes('Identify') || info.includes('Heartbeat')) {
        console.log(`[DEBUG] ${info}`);
    }
});

client.on('error', err => console.error('❌ Discord Client Error:', err));

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

// --- 🚀 เริ่มระบบ (เวอร์ชันรายงานผลละเอียด) ---
async function start() {
    try {
        console.log('--- 🚀 Starting Services Verification ---');
        console.log(`📡 Checking Env Vars: TOKEN=${process.env.DISCORD_TOKEN ? 'YES' : 'NO'}`);

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ DB Connected Successfully');

        if (process.env.DISCORD_TOKEN) {
            console.log('🔐 Attempting Discord Login...');
            
            // รอรับสัญญาณว่าออนไลน์จริง
            client.once(Events.ClientReady, c => {
                console.log('******************************************');
                console.log(`✅✅✅ SUCCESS! BOT IS ONLINE AS: ${c.user.tag}`);
                console.log('******************************************');
                deployCommands(); 
            });

            // สั่ง Login พร้อมดัก Error
            await client.login(process.env.DISCORD_TOKEN).catch(err => {
                console.error('❌ DISCORD LOGIN FAILED!');
                console.error(`Reason: ${err.message}`);
                if (err.message.includes('disallowed intents')) {
                    console.error('👉 วิธีแก้: ไปที่ Discord Developer Portal > Bot > เปิด "Message Content Intent"');
                }
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