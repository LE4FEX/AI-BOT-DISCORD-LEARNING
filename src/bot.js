const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const { getAIAnalysis } = require('./ai');
const { getMarketSentiment, getStockPrice, getStockProfile, getStockNews, getStockHistory, calculateRSI, calculateEMA, getChartUrl } = require('./data');
const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');
const Dca = require('./models/dca');
const Snapshot = require('./models/snapshot');
const Alert = require('./models/alert');
const { updatePortfolio, addDividend } = require('./portfolio-service');
const { env } = require('./config');

// ─────────────────────────────────────────
// Client
// ─────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
const chunkText = (text, size = 3900) => text.match(/[\s\S]{1,3900}/g) || [text];

const embedFor = (title, description, color) => {
  const embed = new EmbedBuilder()
    .setTitle(title || 'Notification')
    .setDescription(description?.trim() || 'No content available.')
    .setTimestamp();
  embed.setColor(typeof color === 'number' ? color : 0x0099ff);
  return embed;
};

/**
 * ส่ง Embed โดยรองรับทั้ง reply / editReply / followUp
 * และตัดข้อความอัตโนมัติถ้ายาวเกิน Discord limit
 */
const sendEmbed = async (interaction, title, description, color) => {
  const text = description?.trim() || 'No content available.';
  const chunks = chunkText(text);
  const finalColor = typeof color === 'number' ? color : 0x0099ff;

  const firstEmbed = embedFor(title, chunks[0], finalColor);

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [firstEmbed], content: '' });
  } else {
    await interaction.reply({ embeds: [firstEmbed], content: '' });
  }

  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp({
      embeds: [embedFor('', chunks[i], finalColor)],
      content: '',
    });
  }
};

/**
 * ฟอร์แมต Watchlist พร้อมราคาปัจจุบัน
 */
const formatWatchlist = async (stocks) => {
  let totalPortfolioValue = 0;
  let totalPortfolioCost = 0;

  const lines = await Promise.all(
    stocks.map(async (stock) => {
      try {
        const q = await getStockPrice(stock.symbol);
        const currentVal = q.price * stock.amount;
        const totalCost = stock.avgPrice * stock.amount;
        const profit = currentVal - totalCost;
        const profitPercent = (profit / totalCost) * 100;
        totalPortfolioValue += currentVal;
        totalPortfolioCost += totalCost;
        const emoji = profit >= 0 ? '🟢' : '🔴';
        return `${emoji} **${stock.symbol}**: $${q.price.toFixed(2)} (ต้นทุน: $${stock.avgPrice.toFixed(2)})\n > ถือ: ${stock.amount.toFixed(4)} | P/L: $${profit.toFixed(2)} (${profitPercent.toFixed(2)}%)`;
      } catch {
        return `⚪ **${stock.symbol}**: N/A`;
      }
    })
  );

  const totalProfit = totalPortfolioValue - totalPortfolioCost;
  const totalProfitPercent =
    totalPortfolioCost > 0 ? (totalProfit / totalPortfolioCost) * 100 : 0;

  return { lines, totalPortfolioValue, totalProfit, totalProfitPercent };
};

// ─────────────────────────────────────────
// Command Handlers
// ─────────────────────────────────────────
const handlers = {
  // 1. เช็คราคาหุ้น
  stock: async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const [q, history, news] = await Promise.all([
      getStockPrice(symbol),
      getStockHistory(symbol),
      getStockNews(symbol),
    ]);
    const rsi = calculateRSI(history);
    const ema20 = calculateEMA(history, 20);
    const chartUrl = getChartUrl(symbol, history);

    const technical =
      `📊 **Technical Indicators:**\n` +
      `- **RSI (14):** ${rsi ? rsi.toFixed(2) : 'N/A'} (${rsi > 70 ? 'Overbought ⚠️' : rsi < 30 ? 'Oversold 💎' : 'Neutral'})\n` +
      `- **EMA (20):** $${ema20 ? ema20.toFixed(2) : 'N/A'} (Price is ${q.price > ema20 ? 'Above 📈' : 'Below 📉'} EMA20)`;

    const analysis = await getAIAnalysis(
      `วิเคราะห์หุ้น ${symbol} ราคา $${q.price} RSI: ${rsi} EMA20: ${ema20} ข่าว: ${news}`
    );

    const embed = embedFor(
      `📈 Analysis: ${symbol}`,
      `**Price:** $${q.price}\n\n${technical}\n\n🕵️ **AI Analysis:**\n${analysis}`
    );
    if (chartUrl) embed.setImage(chartUrl);
    await interaction.editReply({ embeds: [embed] });
  },

  // 2. เพิ่มหุ้น
  'add-stock': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const amount = interaction.options.getNumber('amount');
    const avgPrice = interaction.options.getNumber('avg_price');
    const fee = interaction.options.getNumber('fee') || 0;
    await getStockPrice(symbol);
    await updatePortfolio(interaction.user.id, symbol, amount, avgPrice, false, fee);
    await interaction.editReply(
      `✅ เพิ่มหุ้น **${symbol}** เข้าพอร์ตเรียบร้อย! (รวมค่าธรรมเนียม $${fee.toFixed(2)})`
    );
  },

  // 3. ลบหุ้น
  'remove-stock': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const result = await Watchlist.deleteOne({ userId: interaction.user.id, symbol });
    await interaction.editReply(
      result.deletedCount
        ? `🗑️ ลบหุ้น **${symbol}** เรียบร้อย`
        : `❌ ไม่พบหุ้น **${symbol}**`
    );
  },

  // 4. ดู Watchlist
  watchlist: async (interaction) => {
    const stocks = await Watchlist.find({ userId: interaction.user.id });
    if (!stocks.length) return interaction.editReply('📭 พอร์ตว่างเปล่า');
    const { lines, totalPortfolioValue, totalProfit, totalProfitPercent } =
      await formatWatchlist(stocks);
    const summary =
      `📊 **ภาพรวมพอร์ตของคุณ**\n` +
      `💰 **มูลค่ารวม:** $${totalPortfolioValue.toFixed(2)}\n` +
      `💵 **กำไร/ขาดทุนรวม:** $${totalProfit.toFixed(2)} (${totalProfitPercent.toFixed(2)}%)\n\n` +
      `🔍 **รายละเอียดรายตัว:**\n${lines.join('\n')}`;
    await sendEmbed(interaction, 'My Watchlist', summary, 0xffa500);
  },

  // 5. แก้ไขหุ้น
  'update-stock': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const amount = interaction.options.getNumber('amount');
    const avgPrice = interaction.options.getNumber('avg_price');
    const stock = await Watchlist.findOneAndUpdate(
      { userId: interaction.user.id, symbol },
      { amount, avgPrice }
    );
    await interaction.editReply(
      stock
        ? `✅ อัปเดตหุ้น **${symbol}** เรียบร้อย!`
        : `❌ ไม่พบหุ้น **${symbol}**`
    );
  },

  // 6. ประวัติรายการ ✅ FIX: ใช้ editReply เสมอ (deferReply ถูกเรียกแล้วข้างนอก)
  history: async (interaction) => {
    const logs = await Transaction.find({ userId: interaction.user.id })
      .sort({ _id: -1 })
      .limit(10);
    if (!logs.length) return interaction.editReply('📭 ไม่มีประวัติ');
    const text =
      `📜 **ประวัติ 10 รายการล่าสุด**\n` +
      logs
        .map(
          (log) =>
            `🔹 **${log.type}** ${log.symbol} | ${log.amount} หุ้น | $${log.price}`
        )
        .join('\n');
    await interaction.editReply(text);
  },

  // 7. วิเคราะห์พอร์ต ✅ FIX: ใช้ editReply เสมอ
  'analyze-portfolio': async (interaction) => {
    const stocks = await Watchlist.find({ userId: interaction.user.id });
    if (!stocks.length) return interaction.editReply('📭 พอร์ตว่างเปล่า');

    const data = await Promise.all(
      stocks.map(async (stock) => {
        try {
          const [q, news] = await Promise.all([
            getStockPrice(stock.symbol),
            getStockNews(stock.symbol),
          ]);
          return {
            symbol: stock.symbol,
            profit: (q.price - stock.avgPrice).toFixed(2),
            news,
          };
        } catch {
          return { symbol: stock.symbol, profit: 'N/A', news: 'N/A' };
        }
      })
    );

    const aiResult = await getAIAnalysis(`วิเคราะห์พอร์ต: ${JSON.stringify(data)}`);
    await sendEmbed(interaction, '🤖 AI Strategic Analysis', aiResult, 0x00ff00);
  },

  // 8. ถาม AI
  ask: async (interaction) => {
    const question = interaction.options.getString('question');
    const aiResult = await getAIAnalysis(`คำถาม: ${question}`);
    await sendEmbed(interaction, '💬 AI Q&A', aiResult);
  },

  // 9. ค้นหาหุ้นเด่น
  discover: async (interaction) => {
    const aiResult = await getAIAnalysis('แนะนำหุ้นเด่น 3 ตัววันนี้');
    await sendEmbed(interaction, '🌟 AI Discovery', aiResult, 0x9b59b6);
  },

  // 10. สภาวะตลาด
  sentiment: async (interaction) => {
    const sentiment = await getMarketSentiment();
    if (!sentiment) return interaction.editReply('❌ ดึงข้อมูลไม่ได้');
    await sendEmbed(
      interaction,
      '🌡️ Market Sentiment',
      `**Stock:** ${sentiment.stock.score} (${sentiment.stock.rating})\n**Crypto:** ${sentiment.crypto.score} (${sentiment.crypto.rating})`,
      0xffff00
    );
  },

  // 11. วิเคราะห์การกระจายความเสี่ยง ✅ FIX: ใช้ editReply เสมอ
  'analyze-diversification': async (interaction) => {
    const stocks = await Watchlist.find({ userId: interaction.user.id });
    if (!stocks.length) return interaction.editReply('📭 พอร์ตว่างเปล่า');

    const results = await Promise.all(
      stocks.map(async (stock) => {
        try {
          const [q, profile] = await Promise.all([
            getStockPrice(stock.symbol),
            getStockProfile(stock.symbol),
          ]);
          return {
            symbol: stock.symbol,
            sector: profile.sector || 'Other',
            value: q.price * stock.amount,
          };
        } catch {
          return null;
        }
      })
    );

    const allocation = results.filter(Boolean).reduce((acc, item) => {
      acc[item.sector] = (acc[item.sector] || 0) + item.value;
      return acc;
    }, {});

    const total = Object.values(allocation).reduce((sum, v) => sum + v, 0);
    const sectorText = Object.entries(allocation)
      .map(([sector, value]) => `- **${sector}:** ${((value / total) * 100).toFixed(2)}%`)
      .join('\n');

    const aiResult = await getAIAnalysis(
      `วิเคราะห์กระจายความเสี่ยง: ${JSON.stringify(allocation)}`
    );

    await sendEmbed(
      interaction,
      '🧩 Diversification',
      `📈 **Allocation:**\n${sectorText}\n\n🕵️ **AI:**\n${aiResult}`,
      0x3498db
    );
  },

  // 12. DCA - เพิ่มแผน
  'dca-add': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const amount = interaction.options.getNumber('amount');
    const frequency = interaction.options.getString('frequency');
    await getStockPrice(symbol);
    const nextExecution = new Date();
    nextExecution.setMinutes(nextExecution.getMinutes() + 1);
    await Dca.findOneAndUpdate(
      { userId: interaction.user.id, symbol },
      { amount, frequency, nextExecution, isActive: true },
      { upsert: true, new: true }
    );
    await interaction.editReply(
      `✅ ตั้งค่า DCA สำหรับ **${symbol}** เรียบร้อย!\n💵 จำนวน: $${amount.toFixed(2)}\n📅 ความถี่: ${frequency}\n🚀 จะเริ่มดำเนินการเร็วๆ นี้`
    );
  },

  // 13. DCA - ดูรายการ
  'dca-list': async (interaction) => {
    const plans = await Dca.find({ userId: interaction.user.id, isActive: true });
    if (!plans.length) return interaction.editReply('📭 คุณยังไม่มีแผน DCA');
    const list = plans
      .map(
        (p) =>
          `🔹 **${p.symbol}**: $${p.amount.toFixed(2)} (${p.frequency}) | รอบถัดไป: ${p.nextExecution.toLocaleDateString()}`
      )
      .join('\n');
    await sendEmbed(interaction, '📋 Your DCA Plans', list, 0x00ffff);
  },

  // 14. DCA - ลบแผน
  'dca-remove': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const result = await Dca.deleteOne({ userId: interaction.user.id, symbol });
    await interaction.editReply(
      result.deletedCount
        ? `🗑️ ยกเลิก DCA สำหรับ **${symbol}** เรียบร้อย`
        : `❌ ไม่พบแผน DCA สำหรับ **${symbol}**`
    );
  },

  // 15. DCA - สถิติ
  'dca-stats': async (interaction) => {
    const transactions = await Transaction.find({
      userId: interaction.user.id,
      isDca: true,
    });
    if (!transactions.length)
      return interaction.editReply('📭 คุณยังไม่มีประวัติการลงทุนแบบ DCA');

    const stats = transactions.reduce((acc, t) => {
      if (!acc[t.symbol]) acc[t.symbol] = { totalInvested: 0, totalUnits: 0 };
      acc[t.symbol].totalInvested += t.amount * t.price;
      acc[t.symbol].totalUnits += t.amount;
      return acc;
    }, {});

    const lines = await Promise.all(
      Object.entries(stats).map(async ([symbol, data]) => {
        try {
          const q = await getStockPrice(symbol);
          const currentValue = data.totalUnits * q.price;
          const profit = currentValue - data.totalInvested;
          const percent = (profit / data.totalInvested) * 100;
          return `🔹 **${symbol}**: ลงทุน $${data.totalInvested.toFixed(2)} | ปัจจุบัน $${currentValue.toFixed(2)} (${profit >= 0 ? '📈 +' : '📉 '}${percent.toFixed(2)}%)`;
        } catch {
          return `🔹 **${symbol}**: ลงทุน $${data.totalInvested.toFixed(2)} (ดึงราคาปัจจุบันไม่ได้)`;
        }
      })
    );

    await sendEmbed(interaction, '📈 DCA Performance', lines.join('\n'), 0x2ecc71);
  },

  // 16. บันทึกเงินปันผล
  'add-dividend': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const amount = interaction.options.getNumber('amount');
    await addDividend(interaction.user.id, symbol, amount);
    await interaction.editReply(
      `💰 บันทึกเงินปันผล **${symbol}** จำนวน $${amount.toFixed(2)} เรียบร้อย!\n📉 ต้นทุนเฉลี่ยของคุณลดลงแล้ว`
    );
  },

  // 17. Alert - เพิ่ม
  'alert-add': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const price = interaction.options.getNumber('price');
    const type = interaction.options.getString('type');
    await Alert.create({ userId: interaction.user.id, symbol, targetPrice: price, type });
    await interaction.editReply(
      `🔔 ตั้งแจ้งเตือน **${symbol}** เมื่อราคา **${type === 'above' ? 'สูงกว่า' : 'ต่ำกว่า'} $${price}** เรียบร้อย!`
    );
  },

  // 18. Alert - ดูรายการ
  'alert-list': async (interaction) => {
    const alerts = await Alert.find({ userId: interaction.user.id, active: true });
    if (!alerts.length) return interaction.editReply('📭 คุณไม่มีรายการแจ้งเตือน');
    const list = alerts.map((a) => `- **${a.symbol}**: ${a.type} $${a.targetPrice}`).join('\n');
    await sendEmbed(interaction, '🔔 Active Alerts', list, 0xffff00);
  },

  // 19. ประวัติพอร์ต
  'portfolio-history': async (interaction) => {
    const history = await Snapshot.find({ userId: interaction.user.id })
      .sort({ date: -1 })
      .limit(7);
    if (!history.length)
      return interaction.editReply('📭 ยังไม่มีประวัติพอร์ต (ระบบจะเริ่มบันทึกคืนนี้)');
    const list = history
      .reverse()
      .map(
        (s) =>
          `📅 ${s.date.toLocaleDateString()}: **$${s.totalValue.toFixed(2)}** (${s.profit >= 0 ? '+' : ''}$${s.profit.toFixed(2)})`
      )
      .join('\n');
    await sendEmbed(interaction, '📈 Portfolio Growth (7 Days)', list, 0x3498db);
  },
};

// ─────────────────────────────────────────
// Interaction Handler (แก้ไขหลัก)
// ─────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ✅ FIX 1: แยก deferReply ออกมามี try-catch เองเพื่อป้องกัน token หมดอายุ
  try {
    await interaction.deferReply();
  } catch (deferError) {
    // Interaction หมดอายุแล้ว (> 3 วิ) ไม่สามารถทำอะไรได้
    console.error(`[deferReply failed] ${interaction.commandName}:`, deferError.message);
    return;
  }

  // ✅ FIX 2: ตอนนี้ interaction.deferred = true แน่นอน ใช้ editReply ได้เสมอ
  try {
    const handler = handlers[interaction.commandName];
    if (!handler) {
      return interaction.editReply('❌ ไม่พบคำสั่งนี้');
    }
    await handler(interaction);
  } catch (error) {
    console.error(`[handler error] ${interaction.commandName}:`, error);
    const msg = error.message?.includes('Price unavailable')
      ? '❌ ไม่พบข้อมูลหุ้น กรุณาตรวจสอบตัวย่อ'
      : `❌ เกิดข้อผิดพลาด: ${error.message || 'Unknown error'}`;
    await interaction.editReply(msg).catch(console.error);
  }
});

// ─────────────────────────────────────────
// Broadcast (DM)
// ─────────────────────────────────────────
const broadcast = async (userId, message) => {
  try {
    const user = await client.users.fetch(userId);
    await user.send(message);
  } catch {
    console.error(`Failed to DM ${userId}`);
  }
};

// ─────────────────────────────────────────
// Setup
// ✅ FIX 3: ลบ registerCommands() ออกจากที่นี่แล้ว
// ให้ใช้ deploy-commands.js แทน (รันครั้งเดียวเมื่อ commands เปลี่ยน)
// เพื่อป้องกัน "outdated" error จากการ register ซ้ำทุกครั้งที่ bot restart
// ─────────────────────────────────────────
const setupBot = async () => {
  client.once(Events.ClientReady, (c) => {
    console.log(`✅ Jarvis Online as: ${c.user.tag}`);
  });
  await client.login(env.discordToken);
};

module.exports = { setupBot, broadcast, client };