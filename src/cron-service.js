const axios = require('axios');
const { env } = require('./config');

const CRON_JOB_API_KEY = env.cronJobApiKey;
const JOB_ID = env.cronJobId;

async function checkAndWakeCron() {
  if (!CRON_JOB_API_KEY || !JOB_ID) {
    console.log('ℹ️ Cron-job API credentials not found. Skipping wake service.');
    return;
  }

  try {
    const url = `https://api.cron-job.org/jobs/${JOB_ID}`;
    const headers = { 'Authorization': `Bearer ${CRON_JOB_API_KEY}` };

    // 1. ตรวจสอบสถานะปัจจุบัน
    const response = await axios.get(url, { headers });
    
    if (!response.data || !response.data.job) {
      console.error('❌ Cron-job API returned unexpected response format:', response.data);
      return;
    }

    const jobStatus = response.data.job.enabled;

    if (!jobStatus) {
      console.log('⚠️ Cron-job is Inactive! Attempting to reactivate...');
      
      // 2. ถ้าหลับอยู่ ให้สั่งเปิด (Patch status)
      await axios.patch(url, { job: { enabled: true } }, { headers });
      console.log('✅ Cron-job reactivated successfully, Jarvis!');
    } else {
      console.log('ℹ️ Cron-job is currently active.');
    }
  } catch (error) {
    console.error('❌ Failed to sync with Cron-job API:', error.message);
  }
}

function startCronWakeService() {
  if (!CRON_JOB_API_KEY || !JOB_ID) {
    console.log('⚠️ Cron-job configuration missing. Wake service will not start.');
    return;
  }
  
  console.log('🚀 Jarvis Cron-job Wake Service started.');
  // ตรวจสอบทันทีเมื่อเริ่มทำงาน
  checkAndWakeCron();
  // ตั้งให้ Jarvis ตรวจสอบสถานะ Cron-job ทุกๆ 1 ชั่วโมง
  setInterval(checkAndWakeCron, 60 * 60 * 1000);
}

module.exports = { startCronWakeService };
