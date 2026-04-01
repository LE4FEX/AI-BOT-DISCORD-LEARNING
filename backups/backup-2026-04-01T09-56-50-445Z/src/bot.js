const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAIAnalysis } = require('./ai');
const { MARKET_LEADERS, getMarketSentiment, getStockPrice, getStockProfile, getStockNews } = require('./data');
const Watchlist = require('./models/watchlist');
const Transaction = require('./models/transaction');
const { env } = require('./config');

const commands = [
  new SlashCommandBuilder().setName('stock').setDescription('เช็คราคาหุ้นและวิเคราะห์').addStringOption((o) => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)),
  new SlashCommandBuilder().setName('add-stock').setDescription('เพิ่มหุ้นเข้า Watchlist').addStringOption((o) => o.setName('symbol').setDescription('ชื่อย่อหุ้น').setRequired(true)).addNumberOption((o) => o.setName('amount').setDescription('จำนวน').setRequired(true)).addNumberOption((o) => o.setName('avg_price').setDescription('ราคาเฉลี่ย').setRequired(true)),
  new SlashCommandBuilder().setName('remove-stock').setDescription('ลบหุ้นออก').addStringOption((o) => o.setName('symbol').setDescription('ตัวย่อหุ้น').setRequired(true)),
  new SlashCommandBuilder().setName('watchlist').setDescription('ดู Watchlist'),
  new SlashCommandBuilder().setName('update-stock').setDescription('แก้ไขข้อมูลหุ้น').addStringOption((o) => o.setName('symbol').setDescription('ชื่อหุ้น').setRequired(true)).addNumberOption((o) => o.setName('amount').setDescription('จำนวน').setRequired(true)).addNumberOption((o) => o.setName('avg_price').setDescription('ราคาเฉลี่ย').setRequired(true)),
  new SlashCommandBuilder().setName('history').setDescription('ดูประวัติรายการ'),
  new SlashCommandBuilder().setName('analyze-portfolio').setDescription('วิเคราะห์พอร์ตละเอียด'),
  new SlashCommandBuilder().setName('ask').setDescription('ถามคำถาม AI').addStringOption((o) => o.setName('question').setDescription('คำถาม').setRequired(true)),
  new SlashCommandBuilder().setName('discover').setDescription('ค้นหาหุ้นน่าสนใจ'),
  new SlashCommandBuilder().setName('sentiment').setDescription('เช็คสภาวะตลาด'),
  new SlashCommandBuilder().setName('analyze-diversification').setDescription('วิเคราะห์การกระจายตัวพอร์ต'),
].map((cmd) => cmd.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const chunkText = (text, size = 3900) => text.match(/[\s\S]{1,3900}/g) || [text];
const embedFor = (title, description, color) => new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();

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
  let total = 0;
  const lines = await Promise.all(
    stocks.map(async (stock) => {
      try {
        const q = await getStockPrice(stock.symbol);
        const profit = (q.price - stock.avgPrice) * stock.amount;
        total += profit;
        return `${profit >= 0 ? '🟢' : '🔴'} **${stock.symbol}**: $${q.price.toFixed(2)} (P/L: $${profit.toFixed(2)})`;
      } catch {
        return `⚪ **${stock.symbol}**: N/A`;
      }
    })
  );
  return { lines, total };
};

const handlers = {
  stock: async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const q = await getStockPrice(symbol);
    const analysis = await getAIAnalysis(`วิเคราะห์หุ้น ${symbol} ราคา $${q.price} ข่าว: ${await getStockNews(symbol)}`);
    await sendEmbed(interaction, `📈 Analysis: ${symbol}`, `**Price:** $${q.price}\n\n${analysis}`);
  },

  'add-stock': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const amount = interaction.options.getNumber('amount');
    const avgPrice = interaction.options.getNumber('avg_price');
    const existing = await Watchlist.findOne({ userId: interaction.user.id, symbol });

    if (existing) {
      existing.avgPrice = ((existing.amount * existing.avgPrice) + amount * avgPrice) / (existing.amount + amount);
      existing.amount += amount;
      await existing.save();
    } else {
      await Watchlist.create({ userId: interaction.user.id, symbol, amount, avgPrice });
    }

    await Transaction.create({ userId: interaction.user.id, symbol, type: 'BUY', amount, price: avgPrice });
    await interaction.editReply(`✅ เพิ่มหุ้น **${symbol}** เรียบร้อย!`);
  },

  'remove-stock': async (interaction) => {
    const symbol = interaction.options.getString('symbol').toUpperCase();
    const result = await Watchlist.deleteOne({ userId: interaction.user.id, symbol });
    await interaction.editReply(result.deletedCount ? `🗑️ ลบหุ้น **${symbol}** เรียบร้อย` : `❌ ไม่พบหุ้น **${symbol}**`);
  },

  watchlist: async (interaction) => {
    const stocks = await Watchlist.find({ userId: interaction.user.id });
    if (!stocks.length) return interaction.editReply('📭 พอร์ตว่างเปล่า');
    const { lines, total } = await formatWatchlist(stocks);
    await sendEmbed(interaction, 'My Watchlist', `📊 **Overview**\n${lines.join('\n')}\n\n💰 **Total P/L: $${total.toFixed(2)}**`, 0xFFA500);
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