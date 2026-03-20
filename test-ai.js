require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function runTest() {
    console.log("🔍 ตรวจสอบ API Key...");
    if (!process.env.GEMINI_API_KEY) {
        console.error("❌ ไม่พบ GEMINI_API_KEY ในไฟล์ .env");
        return;
    }
    console.log("✅ พบ API Key:", process.env.GEMINI_API_KEY.substring(0, 10) + "...");

    try {
        console.log("กำลังส่งคำขอไปที่ Gemini 2.5 Flash...");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const result = await model.generateContent("ทดสอบระบบ ตอบกลับสั้นๆว่า 'ระบบทำงานปกติครับ'");
        console.log("\n🎉 คำตอบจาก AI:");
        console.log(result.response.text());
    } catch (error) {
        console.error("\n❌ เกิดข้อผิดพลาดจาก Gemini API:");
        console.error(error);
    }
}

runTest();