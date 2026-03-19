const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { SlashCommandBuilder } = require('@discordjs/builders');

const commands = [
    new SlashCommandBuilder()
        .setName('stock')
        .setDescription('เช็คราคาหุ้นแบบ Real-time')
        .addStringOption(option => 
            option.setName('symbol')
                .setDescription('ตัวย่อหุ้น (เช่น MSFT, NVDA)')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('add-stock')
        .setDescription('เพิ่มหุ้นเข้า Watchlist พร้อมราคาต้นทุน')
        .addStringOption(option => 
            option.setName('symbol')
                .setDescription('ชื่อย่อหุ้น (เช่น NVDA)')
                .setRequired(true))
        .addNumberOption(option => 
            option.setName('amount')
                .setDescription('จำนวนหุ้นที่ถือ')
                .setRequired(true))
        .addNumberOption(option => 
            option.setName('avg_price')
                .setDescription('ราคาเฉลี่ยที่ซื้อมา (USD)')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('remove-stock')
        .setDescription('ลบหุ้นออกจาก Watchlist')
        .addStringOption(option => 
            option.setName('symbol')
                .setDescription('ตัวย่อหุ้น (เช่น MSFT, NVDA)')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('watchlist')
        .setDescription('ดูหุ้นทั้งหมดใน Watchlist ของคุณ'),
    new SlashCommandBuilder()
        .setName('update-stock')
        .setDescription('แก้ไขข้อมูลหุ้นในพอร์ต (ใช้เมื่อกรอกผิด)')
        .addStringOption(option => option.setName('symbol').setDescription('ชื่อหุ้น').setRequired(true))
        .addNumberOption(option => option.setName('amount').setDescription('จำนวนหุ้นที่ถูกต้องทั้งหมด').setRequired(true))
        .addNumberOption(option => option.setName('avg_price').setDescription('ราคาต้นทุนเฉลี่ยที่ถูกต้อง').setRequired(true)),
    new SlashCommandBuilder()
        .setName('history')
        .setDescription('ดูประวัติการทำรายการ')
        .addStringOption(option => option.setName('symbol').setDescription('ชื่อหุ้น (ไม่ใส่ = ดูทั้งหมด)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('analyze-portfolio')
        .setDescription('ให้ AI (Gemini) ช่วยวิเคราะห์พอร์ตการลงทุนของคุณอย่างละเอียด'),
    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('ถามคำถามเกี่ยวกับหุ้นหรือการลงทุนกับ AI')
        .addStringOption(option => 
            option.setName('question')
                .setDescription('คำถามของคุณ')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('discover')
        .setDescription('ค้นหาหุ้นที่น่าสนใจและมีโอกาสทำกำไรในขณะนี้'),
    new SlashCommandBuilder()
        .setName('sentiment')
        .setDescription('เช็คสภาวะตลาด (Fear & Greed Index) ทั้งหุ้นและคริปโต'),
    new SlashCommandBuilder()
        .setName('analyze-diversification')
        .setDescription('วิเคราะห์การกระจายความเสี่ยงของพอร์ตคุณตามกลุ่มอุตสาหกรรม (Sectors)'),
];

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();