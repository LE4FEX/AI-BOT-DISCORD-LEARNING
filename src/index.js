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

// --- ฟังก์ชันดึง Model ---
function getModel(folder, file) {
    const rootPath = path.join(process.cwd(), folder, file);
    const relativePath = path.join(__dirname, '..', folder, file);
    if (fs.existsSync(rootPath + '.js')) return require(rootPath);
    if (fs.existsSync(relativePath + '.js')) return require(relativePath);
    throw new Error(`Cannot find module '${file}'`);
}

const Watchlist = getModel('models', 'watchlist');
const Transaction = getModel('models', 'transaction');

// ตั้งค่า Gemini
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

// --- Slash Commands ---
const commands = [
    new SlashCommandBuilder().setName('stock').setDescription('เช็คราคาหุ้นและวิเคราะห์').addStringOption(o => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)),
    new SlashCommandBuilder().setName('add-stock').setDescription('เพิ่มหุ้นเข้าพอร์ต').addStringOption(o => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)).addNumberOption(o => o.setName('amount').setDescription('จำนวน').setRequired(true)).addNumberOption(o => o.setName('avg_price').setDescription('ราคาเฉลี่ย').setRequired(true)),
    new SlashCommandBuilder().setName('watchlist').setDescription('ดูหุ้นทั้งหมดในพอร์ต'),
    new SlashCommandBuilder().setName('ask').setDescription('ถาม AI').addStringOption(o => o.setName('question').setDescription('คำถาม').setRequired(true)),
    new SlashCommandBuilder().setName('sentiment').setDescription('เช็คสภาวะตลาด')
].map(cmd => cmd.toJSON());

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// --- ฟังก์ชัน Deploy Commands (แยกออกมาทำงานอิสระ) ---
async function deployCommands() {
    if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) return;
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('⏳ Updating Slash Commands...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Slash Commands Synchronized');
    } catch (error) { console.error('❌ Deploy Error:', error); }
}

// --- Events ---
client.once(Events.ClientReady, c => {
    console.log(`✅✅✅ BOT IS ONLINE: ${c.user.tag}`); // ถ้าเห็นบรรทัดนี้คือสำเร็จ!
});

// (ใส่ Interaction Handler เดิมของคุณตรงนี้...)
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    await interaction.deferReply();
    try {
        if (interaction.commandName === 'stock') {
            // Logic หุ้นของคุณ...
            await interaction.editReply('ระบบกำลังวิเคราะห์หุ้น...');
        }
    } catch (e) { await interaction.editReply('Error: ' + e.message); }
});

// --- Start Services ---
async function start() {
    try {
        // 1. เชื่อมต่อฐานข้อมูล
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB Connected');

        // 2. Login ทันที (เพื่อให้บอทออนไลน์จุดเขียว)
        if (process.env.DISCORD_TOKEN) {
            console.log('🔐 Logging in to Discord...');
            await client.login(process.env.DISCORD_TOKEN);
            
            // 3. หลังจาก Online แล้วค่อยอัปเดตคำสั่ง (แบบไม่รอให้มันค้าง)
            deployCommands(); 
        } else {
            console.error('❌ DISCORD_TOKEN missing');
        }
    } catch (err) {
        console.error('❌ Start Error:', err);
    }
}

app.get('/', (req, res) => res.send('Bot Status: Online'));
app.listen(port, () => console.log(`🌍 Server active on ${port}`));

start();