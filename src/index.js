const express = require('express');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');

// Models
const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');

// Setup AI - ใช้รุ่นล่าสุดที่เสถียรที่สุดในตอนนี้
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-2.5-flash"; // กลับไปใช้รุ่นที่ใช้งานได้ตามปกติเพื่อแก้ปัญหา 404

// กำหนด System Instruction เพื่อควบคุมสไตล์การตอบ
const systemInstruction = `คุณคือ 'AI Alpha' นักวิเคราะห์การลงทุนมืออาชีพ
หน้าที่ของคุณ:
1. ตอบคำถามเกี่ยวกับการลงทุน หุ้น ตลาดทุน และเศรษฐกิจ อย่างมีสาระและแม่นยำ
2. หากเป็นคำถามทั่วไปเกี่ยวกับหุ้น ให้เน้นการอธิบายเชิงกลยุทธ์ ปัจจัยพื้นฐาน หรือปัจจัยทางเทคนิค
3. ตัดคำทักทายและคำฟุ่มเฟือยออกทั้งหมด (เช่น "สวัสดีครับ", "ยินดีที่ได้ตอบคำถาม")
4. หากข้อมูลที่ผู้ใช้ถามไม่อยู่ในฐานข้อมูล หรือเป็นเรื่องที่ไม่เกี่ยวกับการลงทุน ให้แจ้งอย่างสุภาพว่า "ผมเชี่ยวชาญด้านการลงทุนเท่านั้น"
5. ใช้ภาษาไทยที่เป็นทางการ กระชับ และได้ใจความ`;

// --- UTILITY FUNCTIONS ---

// ฟังก์ชันเรียกใช้ AI แบบกำหนดสไตล์
async function getAIAnalysis(prompt) {
    try {
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME,
            systemInstruction: systemInstruction
        });
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) {
        console.error("AI Error Detailed:", e);
        if (e.message.includes("404")) {
            return "⚠️ AI Error: ไม่พบ Model ที่ระบุ (404) กรุณาตรวจสอบ MODEL_NAME";
        }
        return "⚠️ AI ไม่สามารถวิเคราะห์ได้ในขณะนี้";
    }
}
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('AI Investment Bot is Active! 🚀'));
app.listen(port, () => console.log(`Listening on port ${port}`));

// Discord Client Setup
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.DirectMessages, 
        GatewayIntentBits.GuildMessages
    ] 
});

// --- UTILITY FUNCTIONS ---

// 1. ฟังก์ชันส่งข้อความยาวๆ โดยการแบ่งเป็นส่วนๆ (ป้องกัน Discord 2000 Char Limit)
async function sendLongMessage(interaction, text) {
    const maxLength = 1900;
    if (text.length <= maxLength) {
        return await interaction.editReply(text);
    }

    const chunks = [];
    for (let i = 0; i < text.length; i += maxLength) {
        chunks.push(text.substring(i, i + maxLength));
    }

    await interaction.editReply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
    }
}

// 2. ฟังก์ชันดึงพาดหัวข่าวล่าสุดจาก Google News
async function getStockNews(symbol) {
    try {
        const response = await axios.get(`https://www.google.com/search?q=${symbol}+stock+news&tbm=nws`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(response.data);
        let news = [];
        $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => {
            if (i < 3) news.push($(el).text());
        });
        return news.length > 0 ? news.join(' | ') : "No recent news found";
    } catch (e) {
        return "News unavailable at the moment";
    }
}

// 3. ฟังก์ชันดึงราคาหุ้นจาก Yahoo Finance
async function getStockPrice(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        const data = await response.json();
        if (!data.chart || !data.chart.result) throw new Error('Symbol Not Found');
        const result = data.chart.result[0].meta;
        return {
            price: result.regularMarketPrice,
            currency: result.currency,
            symbol: result.symbol,
            previousClose: result.previousClose
        };
    } catch (error) { throw error; }
}

// --- SCHEDULED JOBS (CRON) ---

// 🚨 แจ้งเตือนเมื่อราคาขยับแรง ทุก 30 นาที (จันทร์-ศุกร์)
cron.schedule('*/30 * * * 1-5', async () => {
    console.log("🔍 AI กำลังตรวจสอบความเคลื่อนไหวของตลาด...");
    const allStocks = await Watchlist.find({});
    
    for (const item of allStocks) {
        try {
            const quote = await getStockPrice(item.symbol);
            const change = ((quote.price - quote.previousClose) / quote.previousClose * 100);

            if (Math.abs(change) >= 3) {
                const news = await getStockNews(item.symbol);
                const prompt = `วิเคราะห์ด่วน: ${item.symbol} ขยับแรง ${change.toFixed(2)}% ราคา $${quote.price} (ทุน $${item.avgPrice})
                ข่าวล่าสุด: ${news}
                ระบุ Action Plan: ขาย, DCA, หรือ ถือ พร้อมเหตุผลสั้นๆ 1 ประโยค`;
                
                const analysis = await getAIAnalysis(prompt);
                const user = await client.users.fetch(item.userId);
                await user.send(`📢 **AI Alert: ${item.symbol}**\n${analysis}`);
            }
        } catch (e) { console.error("Cron Monitor Error:", e.message); }
    }
});

// 📅 สรุปพอร์ตรายสัปดาห์ (ทุกวันเสาร์ 10:00 น.)
cron.schedule('0 10 * * 6', async () => {
    const users = await Watchlist.distinct('userId');
    for (const userId of users) {
        try {
            const stocks = await Watchlist.find({ userId });
            let data = [];
            for (const s of stocks) {
                const q = await getStockPrice(s.symbol);
                data.push({ symbol: s.symbol, cost: s.avgPrice, current: q.price, amount: s.amount });
            }

            const prompt = `วิเคราะห์พอร์ตรายสัปดาห์: ${JSON.stringify(data)}
            เน้นกลยุทธ์ Rebalance และ Action Plan สัปดาห์หน้า สรุปเป็น Bullet points สั้นๆ`;
            
            const analysis = await getAIAnalysis(prompt);
            const user = await client.users.fetch(userId);
            await user.send(`🗞️ **Weekly Strategic Report**\n\n${analysis}`);
        } catch (e) { console.error("Weekly Report Error:", e.message); }
    }
});


// --- BOT EVENTS ---

client.once('ready', async () => {
    console.log(`🤖 AI Bot Ready: ${client.user.tag}`);
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ DB Connected');
    } catch (err) {
        console.error('❌ DB Connection Error:', err);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // --- ANALYZE PORTFOLIO (วิเคราะห์เชิงลึก + ข่าว) ---
    if (interaction.commandName === 'analyze-portfolio') {
        await interaction.deferReply();
        try {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");

            let portfolio = [];
            for (const s of stocks) {
                const q = await getStockPrice(s.symbol);
                const news = await getStockNews(s.symbol);
                portfolio.push({ 
                    symbol: s.symbol, cost: s.avgPrice, current: q.price, 
                    profit: ((q.price - s.avgPrice) * s.amount).toFixed(2),
                    amount: s.amount,
                    latestNews: news
                });
            }

            const prompt = `วิเคราะห์พอร์ตหุ้น: ${JSON.stringify(portfolio)}
            1. สรุปภาพรวมตลาดที่กระทบพอร์ต
            2. วิเคราะห์ข่าวที่ส่งผลต่อหุ้นรายตัว
            3. กำหนด Action Plan แยกรายตัวแบบสั้นๆ`;
            
            const analysis = await getAIAnalysis(prompt);
            const fullResponse = `🤖 **AI Strategic Analysis**\n\n${analysis}`;
            
            await sendLongMessage(interaction, fullResponse);

        } catch (e) { 
            console.error("AI Error:", e);
            await interaction.editReply('❌ AI ขัดข้อง: กรุณาลองใหม่อีกครั้ง');
        }

    // --- WATCHLIST ---
    } else if (interaction.commandName === 'watchlist') {
        await interaction.deferReply();
        try {
            const stocks = await Watchlist.find({ userId: interaction.user.id });
            if (stocks.length === 0) return await interaction.editReply("📭 พอร์ตว่างเปล่าครับ");

            let results = [];
            let totalProfit = 0;
            for (const s of stocks) {
                const q = await getStockPrice(s.symbol);
                const p = (q.price - s.avgPrice) * s.amount;
                totalProfit += p;
                results.push(`${p >= 0 ? '🟢' : '🔴'} **${s.symbol}**: $${q.price.toFixed(2)} (ทุน $${s.avgPrice.toFixed(2)})\n   └ กำไร: $${p.toFixed(2)} (${s.amount} หุ้น)`);
            }
            await interaction.editReply(`📊 **Portfolio Overview**\n${results.join('\n')}\n\n💰 **รวมกำไร/ขาดทุนทั้งหมด: $${totalProfit.toFixed(2)}**`);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาดในการดึงข้อมูล"); }

    // --- STOCK ---
    } else if (interaction.commandName === 'stock') {
        await interaction.deferReply();
        const symbol = interaction.options.getString('symbol').toUpperCase();
        try {
            const q = await getStockPrice(symbol);
            const news = await getStockNews(symbol);
            const change = ((q.price - q.previousClose) / q.previousClose * 100);
            
            const prompt = `วิเคราะห์หุ้นรายตัว: ${symbol} ราคา $${q.price} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%) ข่าว: ${news}
            สรุปสั้นๆ 1-2 ประโยคว่าน่าสนใจหรือไม่`;
            
            const analysis = await getAIAnalysis(prompt);

            await interaction.editReply(`📈 **${symbol}**\n💰 ราคา: $${q.price.toFixed(2)} (${change >= 0 ? '🔼' : '🔽'} ${change.toFixed(2)}%)\n📰 สรุป AI: ${analysis}`);
        } catch (e) { await interaction.editReply(`❌ ไม่พบข้อมูลหุ้น ${symbol}`); }

    // --- ADD-STOCK ---
    } else if (interaction.commandName === 'add-stock') {
        await interaction.deferReply();
        const symbol = interaction.options.getString('symbol').toUpperCase();
        const amount = interaction.options.getNumber('amount');
        const avgPrice = interaction.options.getNumber('avg_price');
        
        try {
            let stock = await Watchlist.findOne({ userId: interaction.user.id, symbol });
            if (stock) {
                const newPrice = ((stock.amount * stock.avgPrice) + (amount * avgPrice)) / (stock.amount + amount);
                stock.amount += amount; stock.avgPrice = newPrice;
                await stock.save();
            } else {
                await Watchlist.create({ userId: interaction.user.id, symbol, amount, avgPrice });
            }
            await Transaction.create({ userId: interaction.user.id, symbol, type: 'BUY', amount, price: avgPrice });
            await interaction.editReply(`✅ บันทึกการเพิ่มหุ้น **${symbol}** จำนวน ${amount} หุ้น ที่ราคา $${avgPrice} เรียบร้อย!`);
        } catch (e) { await interaction.editReply("❌ บันทึกข้อมูลไม่สำเร็จ"); }

    // --- REMOVE-STOCK ---
    } else if (interaction.commandName === 'remove-stock') {
        await interaction.deferReply();
        const symbol = interaction.options.getString('symbol').toUpperCase();
        try {
            const stock = await Watchlist.findOne({ userId: interaction.user.id, symbol });
            if (!stock) return await interaction.editReply(`❌ คุณไม่มีหุ้น ${symbol} ใน Watchlist`);
            
            await Transaction.create({ userId: interaction.user.id, symbol, type: 'SELL', amount: stock.amount, price: 0 }); // price=0 because we just remove
            await Watchlist.deleteOne({ _id: stock._id });
            await interaction.editReply(`✅ ลบหุ้น **${symbol}** ออกจาก Watchlist เรียบร้อย!`);
        } catch (e) { await interaction.editReply("❌ เกิดข้อผิดพลาดในการลบข้อมูล"); }

    // --- UPDATE-STOCK ---
    } else if (interaction.commandName === 'update-stock') {
        await interaction.deferReply();
        const symbol = interaction.options.getString('symbol').toUpperCase();
        const amount = interaction.options.getNumber('amount');
        const avgPrice = interaction.options.getNumber('avg_price');
        try {
            let stock = await Watchlist.findOne({ userId: interaction.user.id, symbol });
            if (!stock) return await interaction.editReply(`❌ คุณไม่มีหุ้น ${symbol} ใน Watchlist กรุณาใช้ /add-stock แทน`);
            
            stock.amount = amount;
            stock.avgPrice = avgPrice;
            await stock.save();
            
            await Transaction.create({ userId: interaction.user.id, symbol, type: 'UPDATE', amount, price: avgPrice });
            await interaction.editReply(`✅ อัปเดตข้อมูลหุ้น **${symbol}** เป็น ${amount} หุ้น ที่ราคา $${avgPrice} เรียบร้อย!`);
        } catch (e) { await interaction.editReply("❌ อัปเดตข้อมูลไม่สำเร็จ"); }

    // --- HISTORY ---
    } else if (interaction.commandName === 'history') {
        await interaction.deferReply();
        const symbol = interaction.options.getString('symbol')?.toUpperCase();
        try {
            const query = { userId: interaction.user.id };
            if (symbol) query.symbol = symbol;

            const logs = await Transaction.find(query).sort({ date: -1 }).limit(15);
            if (logs.length === 0) return await interaction.editReply("📭 ไม่พบประวัติการทำรายการ");

            let historyText = logs.map(l => {
                const dateStr = l.date.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
                const icon = l.type === 'BUY' ? '🔵' : (l.type === 'SELL' ? '🔴' : '⚙️');
                return `${icon} **${l.type}** ${l.symbol} | ${l.amount} หุ้น | $${l.price}\n   └ 📅 ${dateStr}`;
            }).join('\n');

            await interaction.editReply(`📜 **ประวัติการทำรายการ 15 รายการล่าสุด**\n${historyText}`);
        } catch (e) { 
            console.error(e);
            await interaction.editReply("❌ เกิดข้อผิดพลาดในการดึงข้อมูลประวัติ"); 
        }

    // --- ASK AI ---
    } else if (interaction.commandName === 'ask') {
        await interaction.deferReply();
        const question = interaction.options.getString('question');
        try {
            const prompt = `คำถามจากนักลงทุน: "${question}"\nช่วยวิเคราะห์และตอบให้ชัดเจน กระชับ และเป็นมืออาชีพ`;
            const analysis = await getAIAnalysis(prompt);
            
            const response = `💬 **Investor Q&A**\n**Q:** ${question}\n**AI Alpha:** ${analysis}`;
            await sendLongMessage(interaction, response);
        } catch (e) {
            console.error(e);
            await interaction.editReply("❌ AI ไม่สามารถตอบคำถามได้ในขณะนี้");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);