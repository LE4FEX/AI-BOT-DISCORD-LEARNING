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
        .setName('add-watchlist')
        .setDescription('เพิ่มหุ้นเข้า Watchlist')
        .addStringOption(option => 
            option.setName('symbol')
                .setDescription('ตัวย่อหุ้น (เช่น MSFT, NVDA)')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('view-watchlist')
        .setDescription('ดูหุ้นทั้งหมดใน Watchlist ของคุณ'),
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