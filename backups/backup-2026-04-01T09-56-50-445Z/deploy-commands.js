const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
    // 1. เช็คราคาหุ้น
    new SlashCommandBuilder()
        .setName('stock')
        .setDescription('เช็คราคาหุ้นแบบ Real-time และวิเคราะห์เบื้องต้น')
        .addStringOption(option => 
            option.setName('symbol')
                .setDescription('ตัวย่อหุ้น (เช่น MSFT, NVDA)')
                .setRequired(true)),

    // 2. เพิ่มหุ้นเข้าพอร์ต
    new SlashCommandBuilder()
        .setName('add-stock')
        .setDescription('เพิ่มหุ้นเข้า Watchlist พร้อมราคาต้นทุน')
        .addStringOption(option => 
            option.setName('symbol')
                .setDescription('ชื่อย่อหุ้น')
                .setRequired(true))
        .addNumberOption(option => 
            option.setName('amount')
                .setDescription('จำนวนหุ้นที่ถือ')
                .setRequired(true))
        .addNumberOption(option => 
            option.setName('avg_price')
                .setDescription('ราคาเฉลี่ยที่ซื้อมา (USD)')
                .setRequired(true)),

    // 3. ลบหุ้น
    new SlashCommandBuilder()
        .setName('remove-stock')
        .setDescription('ลบหุ้นออกจาก Watchlist')
        .addStringOption(option => 
            option.setName('symbol')
                .setDescription('ตัวย่อหุ้นที่ต้องการลบ')
                .setRequired(true)),

    // 4. ดูพอร์ต
    new SlashCommandBuilder()
        .setName('watchlist')
        .setDescription('ดูหุ้นทั้งหมดใน Watchlist ของคุณ'),

    // 5. แก้ไขข้อมูลหุ้น (คำสั่งใหม่)
    new SlashCommandBuilder()
        .setName('update-stock')
        .setDescription('แก้ไขข้อมูลหุ้นในพอร์ต (ใช้เมื่อกรอกผิด)')
        .addStringOption(option => option.setName('symbol').setDescription('ชื่อหุ้น').setRequired(true))
        .addNumberOption(option => option.setName('amount').setDescription('จำนวนหุ้นที่ถูกต้องทั้งหมด').setRequired(true))
        .addNumberOption(option => option.setName('avg_price').setDescription('ราคาต้นทุนเฉลี่ยที่ถูกต้อง').setRequired(true)),

    // 6. ดูประวัติ
    new SlashCommandBuilder()
        .setName('history')
        .setDescription('ดูประวัติการทำรายการ'),

    // 7. วิเคราะห์พอร์ตด้วย AI
    new SlashCommandBuilder()
        .setName('analyze-portfolio')
        .setDescription('ให้ AI ช่วยวิเคราะห์กลยุทธ์พอร์ตของคุณอย่างละเอียด'),

    // 8. ถาม AI
    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('ถามคำถามเกี่ยวกับการลงทุนกับ AI')
        .addStringOption(option => 
            option.setName('question')
                .setDescription('คำถามที่คุณต้องการทราบ')
                .setRequired(true)),

    // 9. ค้นหาหุ้นเด่น
    new SlashCommandBuilder()
        .setName('discover')
        .setDescription('ให้ AI ช่วยค้นหาหุ้นที่น่าสนใจจากสภาวะตลาดปัจจุบัน'),

    // 10. เช็คสภาวะตลาด
    new SlashCommandBuilder()
        .setName('sentiment')
        .setDescription('เช็คสภาวะตลาด (Fear & Greed Index) ทั้งหุ้นและคริปโต'),

    // 11. วิเคราะห์การกระจายความเสี่ยง
    new SlashCommandBuilder()
        .setName('analyze-diversification')
        .setDescription('วิเคราะห์การกระจายความเสี่ยงของพอร์ตตามกลุ่มอุตสาหกรรม'),
]
.map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('⏳ Started refreshing application (/) commands...');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('❌ Error during command deployment:', error);
    }
})();