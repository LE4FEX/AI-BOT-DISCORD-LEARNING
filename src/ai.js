const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getMarketSentiment } = require('./data');
const { env } = require('./config');
const Usage = require('./models/usage');

const systemInstruction = `คุณคือ 'Jarvis' นักกลยุทธ์การลงทุนระดับโลก ผู้เชี่ยวชาญด้าน Dynamic DCA (การถัวเฉลี่ยต้นทุนแบบยืดหยุ่น) และ Asset Allocation
บุคลิก: สุภาพ, เฉียบขาด, อ้างอิงข้อมูลจริง, อธิบายเข้าใจง่ายเหมือนคุยกับเจ้านาย
หน้าที่หลัก:
1. วิเคราะห์ความถูก/แพง ของหุ้น (Relative Value) โดยใช้ Technical (RSI, EMA) และ Fundamental (ข่าว)
2. แนะนำการปรับสัดส่วน DCA (เช่น ตัวไหนควรซื้อเพิ่มเยอะ ตัวไหนควรชะลอ) โดยเน้นกลยุทธ์ Buy on Dip
3. ประเมินว่าตลาดลงเพราะ "ตกใจชั่วคราว (Noise)" หรือ "พื้นฐานเปลี่ยน (Fundamental shift)"
4. จัดสัดส่วนพอร์ตเพื่อกระจายความเสี่ยง (Diversification) ไม่ให้หนัก Sector ใดเกินไป
5. ตอบเป็นภาษาไทย ใช้ Emoji จัดรูปแบบอ่านง่าย (Bullet points) ลงท้ายด้วย 'ครับเจ้านาย'`;

const genAI = env.geminiKey ? new GoogleGenerativeAI(env.geminiKey) : null;

// กำหนดรุ่นโมเดลตามลำดับความสำคัญ
const PRIMARY_MODEL = env.modelName || "gemini-3.1-flash-lite-preview"; 
const SECONDARY_MODEL = "gemini-2.5-flash";

/**
 * บันทึกสถิติการใช้งาน AI
 * @param {string} type - 'primary' หรือ 'backup'
 */
async function recordUsage(type) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const update = type === 'primary' ? { $inc: { primaryCount: 1 } } : { $inc: { backupCount: 1 } };
    await Usage.findOneAndUpdate({ date: today }, update, { upsert: true });
  } catch (error) {
    console.error('Failed to record AI usage:', error.message);
  }
}

/**
 * ฟังก์ชันหลักในการดึงคำตอบจาก AI พร้อมระบบสำรอง (Fallback Strategy)
 */
async function getJarvisResponse(prompt, specializedInstruction = null) {
  if (!genAI) return '⚠️ Gemini API Key is missing.';

  try {
    const sentiment = await getMarketSentiment();
    const sentimentCtx = sentiment
      ? `\nMarket: Stock ${sentiment.stock.score}(${sentiment.stock.rating}), Crypto ${sentiment.crypto.score}(${sentiment.crypto.rating})`
      : '';

    // --- ลำดับที่ 1: พยายามใช้รุ่น 3.1 Flash-Lite ก่อน ---
    try {
      console.log(`🤖 Jarvis: Attempting with ${PRIMARY_MODEL}...`);
      const model = genAI.getGenerativeModel({ 
        model: PRIMARY_MODEL,
        systemInstruction: (specializedInstruction || systemInstruction) + sentimentCtx
      });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      
      await recordUsage('primary');
      return response.text().trim();

    } catch (primaryError) {
      console.warn(`⚠️ ${PRIMARY_MODEL} Limit reached or error. Switching to backup...`, primaryError.message);
      
      // --- ลำดับที่ 2: ระบบสำรอง สลับมาใช้รุ่น 2.5 Flash ---
      console.log(`🤖 Jarvis: Switching to backup ${SECONDARY_MODEL}...`);
      const backupModel = genAI.getGenerativeModel({ 
        model: SECONDARY_MODEL,
        systemInstruction: (specializedInstruction || systemInstruction) + sentimentCtx
      });
      const result = await backupModel.generateContent(prompt);
      const response = await result.response;
      
      await recordUsage('backup');
      const text = response.text().trim();
      return `[Backup Mode] ${text}`;
    }

  } catch (error) {
    console.error("❌ All AI models failed!", error.message);
    return `⚠️ ขออภัยครับเจ้านาย ระบบสมองกลขัดข้อง: ${error.message}`;
  }
}

// Aliasing เพื่อความเข้ากันได้กับโค้ดเก่า
const getAIAnalysis = getJarvisResponse;

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

module.exports = { getJarvisResponse, getAIAnalysis, getEmbedding };
