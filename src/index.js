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

async function getStockPrice(symbol) {
    // ปรับ URL ให้ดึงข้อมูลแบบ Summary
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    
    try {
        const response = await fetch(url, {
            headers: {
                // หลอก Yahoo ว่าเราคือ Browser จริงๆ เพื่อป้องกันการโดนบล็อก
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'https://finance.yahoo.com/'
            }
        });

        const data = await response.json();
        
        // ตรวจสอบโครงสร้าง JSON ที่ Yahoo ส่งกลับมา
        if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
            throw new Error('Symbol Not Found');
        }

        const result = data.chart.result[0].meta;
        return {
            price: result.regularMarketPrice,
            currency: result.currency,
            symbol: result.symbol,
            previousClose: result.previousClose
        };
    } catch (error) {
        console.error('Fetch Error:', error);
        throw error;
    }
}

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
            const quote = await getStockPrice(symbol);
            
            const price = quote.price.toFixed(2);
            const change = ((parseFloat(price) - quote.previousClose) / quote.previousClose * 100).toFixed(2);
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
    } else if (interaction.commandName === 'add-stock') {
        const symbol = interaction.options.getString('symbol').toUpperCase();
        const userId = interaction.user.id;
        const existing = await Watchlist.findOne({ userId, symbol });
        if (existing) {
            await interaction.reply(`⚠️ ${symbol} อยู่ใน Watchlist อยู่แล้วครับ`);
        } else {
            const newEntry = new Watchlist({ userId, symbol });
            await newEntry.save();
            await interaction.reply(`✅ เพิ่ม ${symbol} เข้า Watchlist แล้วครับ`);
        }
    } else if (interaction.commandName === 'remove-stock') {
        const symbol = interaction.options.getString('symbol').toUpperCase();
        const userId = interaction.user.id;
        const result = await Watchlist.deleteOne({ userId, symbol });
        if (result.deletedCount > 0) {
            await interaction.reply(`✅ ลบ ${symbol} ออกจาก Watchlist แล้วครับ`);
        } else {
            await interaction.reply(`⚠️ ${symbol} ไม่อยู่ใน Watchlist ของคุณครับ`);
        }
    } else if (interaction.commandName === 'watchlist') {
        const userId = interaction.user.id;
        const watchlists = await Watchlist.find({ userId });
        if (watchlists.length === 0) {
            await interaction.reply('📭 Watchlist ของคุณว่างเปล่าครับ');
            return;
        }
        await interaction.deferReply();
        let response = '📋 **Watchlist ของคุณ:**\n';
        for (const entry of watchlists) {
            const sym = entry.symbol;
            try {
                const quote = await getStockPrice(sym);
                const price = quote.price.toFixed(2);
                const change = ((parseFloat(price) - quote.previousClose) / quote.previousClose * 100).toFixed(2);
                const color = change >= 0 ? '🟢' : '🔴';
                response += `• ${quote.symbol}: ${price} ${quote.currency} ${color} ${change}%\n`;
            } catch (e) {
                response += `• ${sym}: ❌ ไม่พบข้อมูล\n`;
            }
        }
        await interaction.editReply(response);
    }
});

// รัน Bot ด้วย Token จาก Secrets
client.login(process.env.DISCORD_TOKEN);