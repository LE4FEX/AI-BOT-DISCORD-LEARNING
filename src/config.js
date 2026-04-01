require('dotenv').config();

const clean = (key) => process.env[key]?.replace(/['"]/g, '').trim();

const env = {
  port: process.env.PORT || 3000,
  discordToken: clean('DISCORD_TOKEN'),
  clientId: clean('CLIENT_ID'),
  mongoUri: clean('MONGODB_URI'),
  geminiKey: clean('GEMINI_API_KEY'),
  modelName: clean('GEMINI_MODEL') || 'gemini-2.5-flash',
  renderUrl: clean('RENDER_EXTERNAL_URL'),
};

module.exports = { clean, env };