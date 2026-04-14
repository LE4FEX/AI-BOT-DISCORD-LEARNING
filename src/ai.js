const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getMarketSentiment } = require('./data');
const { env } = require('./config');

const systemInstruction = `คุณคือ 'Jarvis' นักกลยุทธ์การลงทุนระดับโลก ผู้เชี่ยวชาญด้าน Dynamic DCA (การถัวเฉลี่ยต้นทุนแบบยืดหยุ่น) และ Asset Allocation
บุคลิก: สุภาพ, เฉียบขาด, อ้างอิงข้อมูลจริง, อธิบายเข้าใจง่ายเหมือนคุยกับเจ้านาย
หน้าที่หลัก:
1. วิเคราะห์ความถูก/แพง ของหุ้น (Relative Value) โดยใช้ Technical (RSI, EMA) และ Fundamental (ข่าว)
2. แนะนำการปรับสัดส่วน DCA (เช่น ตัวไหนควรซื้อเพิ่มเยอะ ตัวไหนควรชะลอ) โดยเน้นกลยุทธ์ Buy on Dip
3. ประเมินว่าตลาดลงเพราะ "ตกใจชั่วคราว (Noise)" หรือ "พื้นฐานเปลี่ยน (Fundamental shift)"
4. จัดสัดส่วนพอร์ตเพื่อกระจายความเสี่ยง (Diversification) ไม่ให้หนัก Sector ใดเกินไป
5. ตอบเป็นภาษาไทย ใช้ Emoji จัดรูปแบบอ่านง่าย (Bullet points) ลงท้ายด้วย 'ครับเจ้านาย'`;

const genAI = env.geminiKey ? new GoogleGenerativeAI(env.geminiKey) : null;

const getAIAnalysis = async (prompt, specializedInstruction = null) => {
  if (!genAI) return '⚠️ Gemini API Key is missing.';

  try {
    const sentiment = await getMarketSentiment();
    const sentimentCtx = sentiment
      ? `\nMarket: Stock ${sentiment.stock.score}(${sentiment.stock.rating}), Crypto ${sentiment.crypto.score}(${sentiment.crypto.rating})`
      : '';

    const model = genAI.getGenerativeModel({ 
      model: env.modelName, 
      systemInstruction: (specializedInstruction || systemInstruction) + sentimentCtx 
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();

  } catch (error) {
    console.error('AI Analysis Error:', error.message);
    
    // ถ้าตัวหลักพัง ลองถอยกลับมาตัวที่เสถียรที่สุด (Fallback)
    if (env.modelName !== 'gemini-2.5-flash') {
        try {
            console.log('[AI] Falling back to gemini-2.5-flash...');
            const fallbackModel = genAI.getGenerativeModel({ 
                model: 'gemini-2.5-flash',
                systemInstruction: (specializedInstruction || systemInstruction)
            });
            const result = await fallbackModel.generateContent(prompt);
            const response = await result.response;
            return response.text().trim();
        } catch (fallbackError) {
            console.error('Fallback AI Error:', fallbackError.message);
        }
    }
    
    return `⚠️ AI ขัดข้อง: ${error.message}`;
  }
};

// ฟังก์ชันสำหรับสร้าง Vector Embedding
const getEmbedding = async (text) => {
  if (!genAI) return null;
  try {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error('Embedding Error:', error.message);
    return null;
  }
};

module.exports = { getAIAnalysis, getEmbedding };