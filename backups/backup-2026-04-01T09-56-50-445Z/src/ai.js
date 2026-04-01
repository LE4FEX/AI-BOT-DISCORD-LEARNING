const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getMarketSentiment } = require('./data');
const { env } = require('./config');

const systemInstruction = `คุณคือ 'AI Alpha' ผู้เชี่ยวชาญด้านการวิเคราะห์การลงทุนและที่ปรึกษาทางการเงินส่วนตัว
บุคลิก: สุภาพ, เป็นกันเองแต่เป็นมืออาชีพ, มั่นใจ
หน้าที่: วิเคราะห์หุ้น ตอบคำถามลงทุน โดยใช้โครงสร้าง [บทสรุป/สภาวะตลาด] -> [คำแนะนำ/Action Plan] -> [ความเสี่ยง]
ใช้คำลงท้ายที่สุภาพ (ครับ/ค่ะ) และทักทายสั้นๆ`;

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