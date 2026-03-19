const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { SlashCommandBuilder } = require('@discordjs/builders');

const commands = [
    new SlashCommandBuilder()
        .setName('add-stock')
        .setDescription('เพิ่มหุ้นเข้าพอร์ตพร้อมราคาต้นทุน')
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
        .setName('watchlist')
        .setDescription('ดูหุ้นทั้งหมดในพอร์ตของคุณ'),
    new SlashCommandBuilder()
        .setName('analyze-portfolio')
        .setDescription('ให้ AI ช่วยวิเคราะห์พอร์ตการลงทุนของคุณอย่างละเอียด'),
    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('ถามคำถามเกี่ยวกับหุ้นหรือการลงทุนกับ AI')
        .addStringOption(option => 
            option.setName('question')
                .setDescription('คำถามของคุณ')
                .setRequired(true)),
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