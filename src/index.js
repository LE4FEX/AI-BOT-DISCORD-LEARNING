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
        await interaction.deferReply();
        const symbol = interaction.options.getString('symbol').toUpperCase();
        const amount = interaction.options.getNumber('amount');
        const avgPrice = interaction.options.getNumber('avg_price');
        const userId = interaction.user.id;
        try {
            const existing = await Watchlist.findOne({ userId, symbol });
            if (existing) {
                // สูตรคำนวณค่าเฉลี่ยใหม่
                const newTotalAmount = existing.amount + amount;
                const newTotalCost = (existing.amount * existing.avgPrice) + (amount * avgPrice);
                const newAvgPrice = newTotalCost / newTotalAmount;

                existing.amount = newTotalAmount;
                existing.avgPrice = newAvgPrice;
                await existing.save();
                
                await interaction.editReply(`✅ ซื้อเพิ่มเรียบร้อย! ตอนนี้ถือ **${symbol}** รวม ${newTotalAmount.toFixed(4)} หุ้น (ทุนเฉลี่ย $${newAvgPrice.toFixed(2)})`);
            } else {
                // ถ้ายังไม่มีหุ้นนี้ ก็บันทึกปกติ
                const newEntry = new Watchlist({ userId, symbol, amount, avgPrice });
                await newEntry.save();
                await interaction.editReply(`✅ เพิ่ม **${symbol}** เข้าพอร์ตเรียบร้อยครับ`);
            }
        } catch (error) {
            console.error(error);
            await interaction.editReply('❌ เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        }
    } else if (interaction.commandName === 'remove-stock') {
        await interaction.deferReply();
        const symbol = interaction.options.getString('symbol').toUpperCase();
        const userId = interaction.user.id;
        try {
            const result = await Watchlist.deleteOne({ userId, symbol });
            if (result.deletedCount > 0) {
                await interaction.editReply(`✅ ลบ ${symbol} ออกจาก Watchlist แล้วครับ`);
            } else {
                await interaction.editReply(`⚠️ ${symbol} ไม่อยู่ใน Watchlist ของคุณครับ`);
            }
        } catch (error) {
            console.error(error);
            await interaction.editReply('❌ เกิดข้อผิดพลาดในการลบข้อมูล');
        }
    } else if (interaction.commandName === 'watchlist') {
        // 1. ต้องสั่ง deferReply ทันทีที่รับคำสั่ง!
        await interaction.deferReply(); 
        
        const userId = interaction.user.id;
        try {
            const watchlists = await Watchlist.find({ userId });
            if (watchlists.length === 0) {
                return await interaction.editReply('📭 พอร์ตของคุณว่างเปล่า');
            }

            let totalProfit = 0;
            const results = await Promise.all(watchlists.map(async (entry) => {
                try {
                    const quote = await getStockPrice(entry.symbol);
                    const currentPrice = quote.price;
                    const cost = entry.avgPrice * entry.amount;
                    const currentValue = currentPrice * entry.amount;
                    const profit = currentValue - cost;
                    totalProfit += profit;

                    const profitPercent = ((currentPrice - entry.avgPrice) / entry.avgPrice * 100).toFixed(2);
                    const color = profit >= 0 ? '🟢' : '🔴';

                    return `${color} **${entry.symbol}**: $${currentPrice.toFixed(2)} (${profitPercent}%)\n   └ กำไร: **$${profit.toFixed(2)}** (${entry.amount} หุ้น)`;
                } catch (e) {
                    return `• **${entry.symbol}**: ❌ ดึงข้อมูลไม่ได้`;
                }
            }));

            const totalEmoji = totalProfit >= 0 ? '💰' : '📉';
            const summary = `📊 **พอร์ตการลงทุนของคุณ**\n${results.join('\n')}\n\n${totalEmoji} **กำไร/ขาดทุนรวม: $${totalProfit.toFixed(2)}**`;
            
            await interaction.editReply(summary);
        } catch (error) {
            await interaction.editReply('❌ เกิดข้อผิดพลาด');
        }
    }
});

// รัน Bot ด้วย Token จาก Secrets
client.login(process.env.DISCORD_TOKEN);