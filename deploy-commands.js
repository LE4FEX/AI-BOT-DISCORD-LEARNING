const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
    new SlashCommandBuilder()
        .setName('stock')
        .setDescription('เช็คราคาหุ้นแบบ Real-time')
        .addStringOption(option => option.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('add-stock')
        .setDescription('เพิ่มหุ้นเข้าพอร์ต')
        .addStringOption(option => option.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true))
        .addNumberOption(option => option.setName('amount').setDescription('จำนวนหุ้น').setRequired(true))
        .addNumberOption(option => option.setName('avg_price').setDescription('ราคาต้นทุน').setRequired(true))
        .addNumberOption(option => option.setName('stop_loss').setDescription('จุดตัดขาดทุน (ถ้ามี)'))
        .addNumberOption(option => option.setName('target_price').setDescription('จุดทำกำไร (ถ้ามี)')),

    new SlashCommandBuilder()
        .setName('update-stock')
        .setDescription('แก้ไขข้อมูลหุ้นในพอร์ต')
        .addStringOption(option => option.setName('symbol').setDescription('ชื่อหุ้น').setRequired(true))
        .addNumberOption(option => option.setName('amount').setDescription('จำนวนหุ้นที่ถูกต้องทั้งหมด').setRequired(true))
        .addNumberOption(option => option.setName('avg_price').setDescription('ราคาต้นทุนเฉลี่ยที่ถูกต้อง').setRequired(true))
        .addNumberOption(option => option.setName('stop_loss').setDescription('จุดตัดขาดทุนใหม่'))
        .addNumberOption(option => option.setName('target_price').setDescription('จุดทำกำไรใหม่')),

    new SlashCommandBuilder().setName('watchlist').setDescription('ดูหุ้นทั้งหมดใน Watchlist'),
    
    // จุดที่แก้ไข: เติม Description ให้ symbol
    new SlashCommandBuilder()
        .setName('remove-stock')
        .setDescription('ลบหุ้นออก')
        .addStringOption(o => o.setName('symbol').setDescription('ชื่อหุ้นที่ต้องการลบ').setRequired(true)),
    
    // จุดที่แก้ไข: เติม Description ให้ symbol
    new SlashCommandBuilder()
        .setName('history')
        .setDescription('ดูประวัติทำรายการ')
        .addStringOption(o => o.setName('symbol').setDescription('ชื่อหุ้นที่ต้องการดู (ไม่ใส่ = ดูทั้งหมด)')),
    
    new SlashCommandBuilder().setName('analyze-portfolio').setDescription('AI วิเคราะห์พอร์ตเชิงลึก'),
    
    // จุดที่แก้ไข: เติม Description ให้ question
    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('ถาม AI')
        .addStringOption(o => o.setName('question').setDescription('คำถามที่คุณต้องการคำตอบ').setRequired(true)),
    
    new SlashCommandBuilder().setName('discover').setDescription('ค้นหาหุ้นน่าสนใจ'),
    new SlashCommandBuilder().setName('sentiment').setDescription('เช็คสภาวะตลาด'),
    new SlashCommandBuilder().setName('analyze-diversification').setDescription('วิเคราะห์การกระจายความเสี่ยง'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
    try {
        console.log('⏳ กำลังอัปเดตคำสั่ง...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Updated commands with SL/TP support!');
    } catch (e) { console.error(e); }
})();