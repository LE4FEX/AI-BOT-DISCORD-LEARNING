const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getMarketSentiment } = require('./data');
const { env } = require('./config');

const systemInstruction = `คุณคือ 'AI Alpha' ผู้เชี่ยวชาญด้านการวิเคราะห์การลงทุนระดับโลก
บุคลิก: สุภาพ, มืออาชีพ, มั่นใจ
หน้าที่หลัก:
1. วิเคราะห์ Sentiment ของตลาด/หุ้น (Bullish / Bearish / Neutral) พร้อมให้คะแนนความมั่นใจ 1-10
2. สรุปประเด็นข่าวที่ส่งผลกระทบ และวิเคราะห์ทางเทคนิค (RSI/EMA)
3. ให้กลยุทธ์การลงทุน (Strategic Action Plan)
4. ตอบเป็นภาษาไทย ใช้ Emoji และจัดรูปแบบให้อ่านง่าย (Bullet points)`;

const genAI = env.geminiKey ? new GoogleGenerativeAI(env.geminiKey) : null;

const getAIAnalysis = async (prompt, specializedInstruction = null) => {
  if (!genAI) return '⚠️ Gemini API Key is missing.';
  try {
    const sentiment = await getMarketSentiment();
    const sentimentCtx = sentiment
      ? `\nMarket: Stock ${sentiment.stock.score}(${sentiment.stock.rating}), Crypto ${sentiment.crypto.score}(${sentiment.crypto.rating})`
      : '';
    const model = genAI.getGenerativeModel({ model: env.modelName, systemInstruction: (specializedInstruction || systemInstruction) + sentimentCtx });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error('AI Analysis Error:', error.message);
    return '⚠️ AI ไม่สามารถวิเคราะห์ได้ในขณะนี้ (ตรวจสอบความถูกต้องของ API Key หรือลองใหม่อีกครั้ง)';
  }
};

module.exports = { getAIAnalysis };