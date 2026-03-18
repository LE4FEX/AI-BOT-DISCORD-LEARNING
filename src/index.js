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
    // ใช้ URL นี้จะเสถียรกว่าสำหรับการดึงราคาปัจจุบัน
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        
        // เช็คว่ามีข้อมูลหุ้นตัวนี้จริงไหม
        if (!data.chart.result || data.chart.result.length === 0) {
            throw new Error('Symbol not found');
        }

        const result = data.chart.result[0].meta;
        return {
            price: result.regularMarketPrice.toFixed(2),
            currency: result.currency,
            symbol: result.symbol.toUpperCase(),
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
            
            const price = parseFloat(quote.price);
            const change = ((price - quote.previousClose) / quote.previousClose * 100).toFixed(2);
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
                const quote = await getStockPrice(sym);
                const price = parseFloat(quote.price);
                const change = ((price - quote.previousClose) / quote.previousClose * 100).toFixed(2);
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