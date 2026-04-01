const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAIAnalysis } = require('./ai');
const { MARKET_LEADERS, getMarketSentiment, getStockPrice, getStockProfile, getStockNews, getStockHistory, calculateRSI, calculateEMA, getChartUrl } = require('./data');
const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');
const Dca = require('./models/dca');
const Snapshot = require('./models/snapshot');
const Alert = require('./models/alert');
const { updatePortfolio, addDividend } = require('./portfolio-service');
const { env } = require('./config');

const commands = [
  new SlashCommandBuilder().setName('stock').setDescription('เช็คราคาหุ้นและวิเคราะห์').addStringOption((o) => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)),
  new SlashCommandBuilder().setName('add-stock').setDescription('เพิ่มหุ้นเข้า Watchlist')
    .addStringOption((o) => o.setName('symbol').setDescription('ชื่อย่อหุ้น').setRequired(true))
    .addNumberOption((o) => o.setName('amount').setDescription('จำนวน').setRequired(true))
    .addNumberOption((o) => o.setName('avg_price').setDescription('ราคาเฉลี่ย').setRequired(true))
    .addNumberOption((o) => o.setName('fee').setDescription('ค่าธรรมเนียม (USD)')),
  new SlashCommandBuilder().setName('remove-stock').setDescription('ลบหุ้นออก').addStringOption((o) => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)),
  new SlashCommandBuilder().setName('watchlist').setDescription('ดู Watchlist'),
  new SlashCommandBuilder().setName('update-stock').setDescription('แก้ไขข้อมูลหุ้น').addStringOption((o) => o.setName('symbol').setDescription('ชื่อหุ้น').setRequired(true)).addNumberOption((o) => o.setName('amount').setDescription('จำนวน').setRequired(true)).addNumberOption((o) => o.setName('avg_price').setDescription('ราคาเฉลี่ย').setRequired(true)),
  new SlashCommandBuilder().setName('history').setDescription('ดูประวัติรายการ'),
  new SlashCommandBuilder().setName('analyze-portfolio').setDescription('วิเคราะห์พอร์ตละเอียด'),
  new SlashCommandBuilder().setName('ask').setDescription('ถามคำถาม AI').addStringOption((o) => o.setName('question').setDescription('คำถาม').setRequired(true)),
  new SlashCommandBuilder().setName('discover').setDescription('ค้นหาหุ้นน่าสนใจ'),
  new SlashCommandBuilder().setName('sentiment').setDescription('เช็คสภาวะตลาด'),
  new SlashCommandBuilder().setName('analyze-diversification').setDescription('วิเคราะห์การกระจายตัวพอร์ต'),
  new SlashCommandBuilder().setName('dca-add').setDescription('ตั้งค่า DCA รายวัน/สัปดาห์/เดือน')
    .addStringOption(o => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('จำนวนเงินลงทุนแต่ละครั้ง (USD)').setRequired(true))
    .addStringOption(o => o.setName('frequency').setDescription('ความถี่').setRequired(true).addChoices(
      { name: 'Daily', value: 'DAILY' },
      { name: 'Weekly', value: 'WEEKLY' },
      { name: 'Monthly', value: 'MONTHLY' }
    )),
  new SlashCommandBuilder().setName('dca-list').setDescription('ดูรายการ DCA ของคุณ'),
  new SlashCommandBuilder().setName('dca-remove').setDescription('ลบแผน DCA')
    .addStringOption(o => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)),
  new SlashCommandBuilder().setName('dca-stats').setDescription('ดูสถิติการลงทุนแบบ DCA ทั้งหมดของคุณ'),
  new SlashCommandBuilder().setName('add-dividend').setDescription('บันทึกเงินปันผลเพื่อลดต้นทุน')
    .addStringOption(o => o.setName('symbol').setDescription('ชื่อหุ้น').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('ยอดเงินปันผลรวม (USD)').setRequired(true)),
  new SlashCommandBuilder().setName('alert-add').setDescription('ตั้งแจ้งเตือนราคา')
    .addStringOption(o => o.setName('symbol').setDescription('ชื่อหุ้น').setRequired(true))
    .addNumberOption(o => o.setName('price').setDescription('ราคาเป้าหมาย').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('เงื่อนไข').setRequired(true).addChoices(
      { name: 'สูงกว่า (Above)', value: 'above' },
      { name: 'ต่ำกว่า (Below)', value: 'below' }
    )),
  new SlashCommandBuilder().setName('alert-list').setDescription('ดูรายการแจ้งเตือนทั้งหมด'),
  new SlashCommandBuilder().setName('portfolio-history').setDescription('ดูประวัติการเติบโตของพอร์ต (7 วันย้อนหลัง)'),
].map((cmd) => cmd.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const chunkText = (text, size = 3900) => text.match(/[\s\S]{1,3900}/g) || [text];
const embedFor = (title, description, color = 0x0099FF) => new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();

const sendEmbed = async (interaction, title, description, color = 0x0099FF) => {
  const text = typeof description === 'string' && description.trim().length ? description.trim() : 'No content available.';
  const chunks = chunkText(text);

  const sendFirst = async () => {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ embeds: [embedFor(title, chunks[0], color)], content: '' });
    }
    return interaction.reply({ embeds: [embedFor(title, chunks[0], color)], content: '' });
  };

  try {
    await sendFirst();
  } catch (error) {
    console.error('sendEmbed initial reply failed:', error.message);
    if (!interaction.replied) {
      await interaction.reply({ embeds: [embedFor(title, chunks[0], color)], content: '' });
    } else {
      await interaction.followUp({ embeds: [embedFor(title, chunks[0], color)], content: '' });
    }
  }

  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp({ embeds: [embedFor('', chunks[i], color)], content: '' });
  }
};

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
        return `${emoji} **${stock.symbol}**: $${q.price.toFixed(2)} (ต้นทุน: $${stock.avgPrice.toFixed(2)})\n      > ถือ: ${stock.amount.toFixed(4)} | P/L: $${profit.toFixed(2)} (${profitPercent.toFixed(2)}%)`;
      } catch {
        return `⚪ **${stock.symbol}**: N/A`;
      }
    })
  );
  
  const totalProfit = totalPortfolioValue - totalPortfolioCost;
  const totalProfitPercent = totalPortfolioCost > 0 ? (totalProfit / totalPortfolioCost) * 100 : 0;
  
  return { lines, totalPortfolioValue, totalProfit, totalProfitPercent };
};

const handlers = {
  stock: async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const [q, history, news] = await Promise.all([
      getStockPrice(symbol),
      getStockHistory(symbol),
      getStockNews(symbol)
    ]);

    const rsi = calculateRSI(history);
    const ema20 = calculateEMA(history, 20);
    const chartUrl = getChartUrl(symbol, history);

    const technical = `📊 **Technical Indicators:**\n` +
      `- **RSI (14):** ${rsi ? rsi.toFixed(2) : 'N/A'} (${rsi > 70 ? 'Overbought ⚠️' : rsi < 30 ? 'Oversold 💎' : 'Neutral'})\n` +
      `- **EMA (20):** $${ema20 ? ema20.toFixed(2) : 'N/A'} (Price is ${q.price > ema20 ? 'Above 📈' : 'Below 📉'} EMA20)`;

    const analysis = await getAIAnalysis(`วิเคราะห์หุ้น ${symbol} ราคา $${q.price} RSI: ${rsi} EMA20: ${ema20} ข่าว: ${news}`);
    
    const embed = embedFor(`📈 Analysis: ${symbol}`, `**Price:** $${q.price}\n\n${technical}\n\n🕵️ **AI Analysis:**\n${analysis}`);
    if (chartUrl) embed.setImage(chartUrl);

    await interaction.editReply({ embeds: [embed] });
  },

  'add-stock': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const amount = interaction.options.getNumber('amount');
    const avgPrice = interaction.options.getNumber('avg_price');
    const fee = interaction.options.getNumber('fee') || 0;

    await getStockPrice(symbol);
    await updatePortfolio(interaction.user.id, symbol, amount, avgPrice, false, fee);
    await interaction.editReply(`✅ เพิ่มหุ้น **${symbol}** เข้าพอร์ตเรียบร้อย! (รวมค่าธรรมเนียม $${fee.toFixed(2)})`);
  },

  'remove-stock': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const result = await Watchlist.deleteOne({ userId: interaction.user.id, symbol });
    await interaction.editReply(result.deletedCount ? `🗑️ ลบหุ้น **${symbol}** เรียบร้อย` : `❌ ไม่พบหุ้น **${symbol}**`);
  },

  watchlist: async (interaction) => {
    const stocks = await Watchlist.find({ userId: interaction.user.id });
    if (!stocks.length) return interaction.editReply('📭 พอร์ตว่างเปล่า');
    
    const { lines, totalPortfolioValue, totalProfit, totalProfitPercent } = await formatWatchlist(stocks);
    
    const summary = `📊 **ภาพรวมพอร์ตของคุณ**\n` +
      `💰 **มูลค่ารวม:** $${totalPortfolioValue.toFixed(2)}\n` +
      `💵 **กำไร/ขาดทุนรวม:** $${totalProfit.toFixed(2)} (${totalProfitPercent.toFixed(2)}%)\n\n` +
      `🔍 **รายละเอียดรายตัว:**\n${lines.join('\n')}`;

    await sendEmbed(interaction, 'My Watchlist', summary, 0xFFA500);
  },

  'update-stock': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const amount = interaction.options.getNumber('amount');
    const avgPrice = interaction.options.getNumber('avg_price');
    const stock = await Watchlist.findOneAndUpdate({ userId: interaction.user.id, symbol }, { amount, avgPrice });
    await interaction.editReply(stock ? `✅ อัปเดตหุ้น **${symbol}** เรียบร้อย!` : `❌ ไม่พบหุ้น **${symbol}**`);
  },

  history: async (interaction) => {
    const logs = await Transaction.find({ userId: interaction.user.id }).sort({ _id: -1 }).limit(10);
    if (!logs.length) return interaction.editReply('📭 ไม่มีประวัติ');
    await interaction.editReply(`📜 **ประวัติ 10 รายการล่าสุด**\n${logs.map((log) => `🔹 **${log.type}** ${log.symbol} | ${log.amount} หุ้น | $${log.price}`).join('\n')}`);
  },

  'analyze-portfolio': async (interaction) => {
    const stocks = await Watchlist.find({ userId: interaction.user.id });
    if (!stocks.length) return interaction.editReply('📭 พอร์ตว่างเปล่า');
    const data = await Promise.all(
      stocks.map(async (stock) => {
        try {
          const [q, news] = await Promise.all([getStockPrice(stock.symbol), getStockNews(stock.symbol)]);
          return { symbol: stock.symbol, profit: (q.price - stock.avgPrice).toFixed(2), news };
        } catch {
          return { symbol: stock.symbol, profit: 'N/A', news: 'N/A' };
        }
      })
    );
    await sendEmbed(interaction, '🤖 AI Strategic Analysis', await getAIAnalysis(`วิเคราะห์พอร์ต: ${JSON.stringify(data)}`), 0x00FF00);
  },

  ask: async (interaction) => sendEmbed(interaction, '💬 AI Q&A', await getAIAnalysis(`คำถาม: ${interaction.options.getString('question')}`)),
  discover: async (interaction) => sendEmbed(interaction, '🌟 AI Discovery', await getAIAnalysis('แนะนำหุ้นเด่น 3 ตัววันนี้'), 0x9B59B6),

  sentiment: async (interaction) => {
    const sentiment = await getMarketSentiment();
    if (!sentiment) return interaction.editReply('❌ ดึงข้อมูลไม่ได้');
    await sendEmbed(interaction, '🌡️ Market Sentiment', `**Stock:** ${sentiment.stock.score} (${sentiment.stock.rating})\n**Crypto:** ${sentiment.crypto.score} (${sentiment.crypto.rating})`, 0xFFFF00);
  },

  'analyze-diversification': async (interaction) => {
    const stocks = await Watchlist.find({ userId: interaction.user.id });
    if (!stocks.length) return interaction.editReply('📭 พอร์ตว่างเปล่า');
    const results = await Promise.all(
      stocks.map(async (stock) => {
        try {
          const [q, profile] = await Promise.all([getStockPrice(stock.symbol), getStockProfile(stock.symbol)]);
          return { symbol: stock.symbol, sector: profile.sector, value: q.price * stock.amount };
        } catch {
          return null;
        }
      })
    );
    const allocation = results.filter(Boolean).reduce((acc, item) => {
      acc[item.sector] = (acc[item.sector] || 0) + item.value;
      return acc;
    }, {});
    const sectorText = Object.entries(allocation)
      .map(([sector, value]) => `- **${sector}:** ${(value / Object.values(allocation).reduce((sum, v) => sum + v, 0) * 100).toFixed(2)}%`)
      .join('\n');
    await sendEmbed(interaction, '🧩 Diversification', `📈 **Allocation:**\n${sectorText}\n\n🕵️ **AI:**\n${await getAIAnalysis(`วิเคราะห์กระจายความเสี่ยง: ${JSON.stringify(allocation)}`)}`, 0x3498DB);
  },

  'dca-add': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const amount = interaction.options.getNumber('amount');
    const frequency = interaction.options.getString('frequency');
    const userId = interaction.user.id;

    // ตรวจสอบว่ามีหุ้นนี้อยู่จริงไหม
    await getStockPrice(symbol);

    const nextExecution = new Date();
    // เริ่มครั้งแรกทันที หรือจะเริ่มพรุ่งนี้? ปกติ DCA มักจะเริ่มทันทีที่ตั้งค่า
    // แต่เพื่อความปลอดภัย ให้เริ่มใน 1 นาทีถัดไป
    nextExecution.setMinutes(nextExecution.getMinutes() + 1);

    await Dca.findOneAndUpdate(
      { userId, symbol },
      { amount, frequency, nextExecution, isActive: true },
      { upsert: true, new: true }
    );

    await interaction.editReply(`✅ ตั้งค่า DCA สำหรับ **${symbol}** เรียบร้อย!\n💵 จำนวน: $${amount.toFixed(2)}\n📅 ความถี่: ${frequency}\n🚀 จะเริ่มดำเนินการเร็วๆ นี้`);
  },

  'dca-list': async (interaction) => {
    const plans = await Dca.find({ userId: interaction.user.id, isActive: true });
    if (!plans.length) return interaction.editReply('📭 คุณยังไม่มีแผน DCA');

    const list = plans.map(p => 
      `🔹 **${p.symbol}**: $${p.amount.toFixed(2)} (${p.frequency}) | รอบถัดไป: ${p.nextExecution.toLocaleDateString()}`
    ).join('\n');

    await sendEmbed(interaction, '📋 Your DCA Plans', list, 0x00FFFF);
  },

  'dca-remove': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const result = await Dca.deleteOne({ userId: interaction.user.id, symbol });
    await interaction.editReply(result.deletedCount ? `🗑️ ยกเลิก DCA สำหรับ **${symbol}** เรียบร้อย` : `❌ ไม่พบแผน DCA สำหรับ **${symbol}**`);
  },

  'dca-stats': async (interaction) => {
    const transactions = await Transaction.find({ userId: interaction.user.id, isDca: true });
    if (!transactions.length) return interaction.editReply('📭 คุณยังไม่มีประวัติการลงทุนแบบ DCA');

    const stats = transactions.reduce((acc, t) => {
      if (!acc[t.symbol]) acc[t.symbol] = { totalInvested: 0, totalUnits: 0 };
      acc[t.symbol].totalInvested += (t.amount * t.price);
      acc[t.symbol].totalUnits += t.amount;
      return acc;
    }, {});

    const lines = await Promise.all(Object.entries(stats).map(async ([symbol, data]) => {
      try {
        const q = await getStockPrice(symbol);
        const currentValue = data.totalUnits * q.price;
        const profit = currentValue - data.totalInvested;
        const percent = (profit / data.totalInvested) * 100;
        return `🔹 **${symbol}**: ลงทุน $${data.totalInvested.toFixed(2)} | ปัจจุบัน $${currentValue.toFixed(2)} (${profit >= 0 ? '📈 +' : '📉 '}${percent.toFixed(2)}%)`;
      } catch {
        return `🔹 **${symbol}**: ลงทุน $${data.totalInvested.toFixed(2)} (ดึงราคาปัจจุบันไม่ได้)`;
      }
    }));

    await sendEmbed(interaction, '📈 DCA Performance', lines.join('\n'), 0x2ECC71);
  },

  'add-dividend': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const amount = interaction.options.getNumber('amount');
    await addDividend(interaction.user.id, symbol, amount);
    await interaction.editReply(`💰 บันทึกเงินปันผล **${symbol}** จำนวน $${amount.toFixed(2)} เรียบร้อย!\n📉 ต้นทุนเฉลี่ยของคุณลดลงแล้ว`);
  },

  'alert-add': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const price = interaction.options.getNumber('price');
    const type = interaction.options.getString('type');
    await Alert.create({ userId: interaction.user.id, symbol, targetPrice: price, type });
    await interaction.editReply(`🔔 ตั้งแจ้งเตือน **${symbol}** เมื่อราคา **${type === 'above' ? 'สูงกว่า' : 'ต่ำกว่า'} $${price}** เรียบร้อย!`);
  },

  'alert-list': async (interaction) => {
    const alerts = await Alert.find({ userId: interaction.user.id, active: true });
    if (!alerts.length) return interaction.editReply('📭 คุณไม่มีรายการแจ้งเตือน');
    const list = alerts.map(a => `- **${a.symbol}**: ${a.type} $${a.targetPrice}`).join('\n');
    await sendEmbed(interaction, '🔔 Active Alerts', list, 0xFFFF00);
  },

  'portfolio-history': async (interaction) => {
    const history = await Snapshot.find({ userId: interaction.user.id }).sort({ date: -1 }).limit(7);
    if (!history.length) return interaction.editReply('📭 ยังไม่มีประวัติพอร์ต (ระบบจะเริ่มบันทึกคืนนี้)');
    const list = history.reverse().map(s => 
      `📅 ${s.date.toLocaleDateString()}: **$${s.totalValue.toFixed(2)}** (${s.profit >= 0 ? '+' : ''}$${s.profit.toFixed(2)})`
    ).join('\n');
    await sendEmbed(interaction, '📈 Portfolio Growth (7 Days)', list, 0x3498DB);
  },
};

const broadcast = async (userId, message) => {
  try {
    const user = await client.users.fetch(userId);
    await user.send(message);
  } catch {
    console.error(`Failed to DM ${userId}`);
  }
};

const registerCommands = async () => {
  const rest = new REST({ version: '10' }).setToken(env.discordToken);
  await rest.put(Routes.applicationCommands(env.clientId), { body: commands });
};

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await interaction.deferReply();
    const handler = handlers[interaction.commandName];
    if (handler) await handler(interaction);
  } catch (error) {
    console.error(error);
    const msg = error.message.includes('Price unavailable') ? '❌ ไม่พบข้อมูลหุ้น' : '❌ เกิดข้อผิดพลาดเทคนิค';
    await interaction.editReply(msg).catch(() => interaction.reply({ content: msg, ephemeral: true }));
  }
});

const setupBot = async () => {
  client.once(Events.ClientReady, async (c) => {
    console.log(`✅ Online as: ${c.user.tag}`);
    await registerCommands();
  });
  await client.login(env.discordToken);
};

module.exports = { setupBot, broadcast, commands, client };