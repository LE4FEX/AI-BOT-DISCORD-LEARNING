const express = require('express');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const mongoose = require('mongoose');
let yahooFinance;
const Watchlist = require('./models/watchlist');

async function initStock() {
    const module = await import('yahoo-finance2');
    yahooFinance = module.default;
}

initStock();

// เซิร์ฟเวอร์ HTTP สำหรับ Render (Health check)
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is running! 🚀');
});

app.listen(port, () => {
  console.log(`Web server listening at http://localhost:${port}`);
});

// สร้าง Client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ฟังก์ชันเชื่อมต่อ Database
async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB Connected!');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err);
    }
}

client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    connectDB(); // เชื่อม DB ทันทีที่ Bot พร้อม
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'stock') {
        const symbol = interaction.options.getString('symbol').toUpperCase();
        
        await interaction.deferReply(); // บอก Discord ว่ากำลังประมวลผลนะ (เพราะ API อาจจะช้า)

        try {
            const quote = await yahooFinance.quote(symbol);
            
            const price = quote.regularMarketPrice;
            const change = quote.regularMarketChangePercent.toFixed(2);
            const currency = quote.currency;

            // ตกแต่งข้อความตอบกลับ
            const color = change >= 0 ? '🟢' : '🔴';
            
            await interaction.editReply(
                `📊 **Stock: ${symbol}**\n` +
                `💰 Price: **${price} ${currency}**\n` +
                `📈 Change: ${color} **${change}%**\n` +
                `🕒 Last Update: <t:${Math.floor(Date.now() / 1000)}:R>`
            );
        } catch (error) {
            await interaction.editReply(`❌ ไม่พบข้อมูลหุ้นชื่อ "${symbol}" หรือเกิดข้อผิดพลาดครับ`);
        }
    } else if (interaction.commandName === 'add-watchlist') {
        const symbol = interaction.options.getString('symbol').toUpperCase();
        const userId = interaction.user.id;
        let watchlist = await Watchlist.findOne({ userId });
        if (!watchlist) {
            watchlist = new Watchlist({ userId, symbols: [] });
        }
        if (!watchlist.symbols.includes(symbol)) {
            watchlist.symbols.push(symbol);
            await watchlist.save();
            await interaction.reply(`✅ เพิ่ม ${symbol} เข้า Watchlist แล้วครับ`);
        } else {
            await interaction.reply(`⚠️ ${symbol} อยู่ใน Watchlist อยู่แล้วครับ`);
        }
    } else if (interaction.commandName === 'view-watchlist') {
        const userId = interaction.user.id;
        const watchlist = await Watchlist.findOne({ userId });
        if (!watchlist || watchlist.symbols.length === 0) {
            await interaction.reply('📭 Watchlist ของคุณว่างเปล่าครับ');
            return;
        }
        await interaction.deferReply();
        let response = '📋 **Watchlist ของคุณ:**\n';
        for (const sym of watchlist.symbols) {
            try {
                const quote = await yahooFinance.quote(sym);
                const price = quote.regularMarketPrice;
                const change = quote.regularMarketChangePercent.toFixed(2);
                const color = change >= 0 ? '🟢' : '🔴';
                response += `• ${sym}: ${price} ${quote.currency} ${color} ${change}%\n`;
            } catch (e) {
                response += `• ${sym}: ❌ ไม่พบข้อมูล\n`;
            }
        }
        await interaction.editReply(response);
    }
});

// รัน Bot ด้วย Token จาก Secrets
client.login(process.env.DISCORD_TOKEN);