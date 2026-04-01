const Alert = require('./models/alert');
const { getStockPrice } = require('./data');
const { broadcast } = require('./bot');

const checkAlerts = async () => {
  const activeAlerts = await Alert.find({ active: true });
  if (activeAlerts.length === 0) return;

  console.log(`[Alert] Checking ${activeAlerts.length} active alerts...`);

  // กลุ่มแจ้งเตือนตาม symbol เพื่อลดการเรียก API
  const symbolGroups = activeAlerts.reduce((acc, alert) => {
    if (!acc[alert.symbol]) acc[alert.symbol] = [];
    acc[alert.symbol].push(alert);
    return acc;
  }, {});

  for (const [symbol, alerts] of Object.entries(symbolGroups)) {
    try {
      const q = await getStockPrice(symbol);
      const currentPrice = q.price;

      for (const alert of alerts) {
        let triggered = false;
        if (alert.type === 'above' && currentPrice >= alert.targetPrice) triggered = true;
        if (alert.type === 'below' && currentPrice <= alert.targetPrice) triggered = true;

        if (triggered) {
          await broadcast(alert.userId, `🔔 **Price Alert Triggered!**\n📈 หุ้น: **${symbol}**\n💰 ราคาปัจจุบัน: **$${currentPrice.toFixed(2)}**\n🎯 เป้าหมาย: ${alert.type === 'above' ? 'สูงกว่า' : 'ต่ำกว่า'} $${alert.targetPrice}`);
          alert.active = false; // ปิดการแจ้งเตือนหลังจากทำงานแล้ว
          await alert.save();
        }
      }
    } catch (error) {
      console.error(`[Alert] Error checking ${symbol}:`, error.message);
    }
  }
};

const startAlertScheduler = () => {
  // ตรวจสอบราคาทุก 10 นาที
  setInterval(checkAlerts, 10 * 60 * 1000);
  console.log('[Alert] Scheduler started');
};

module.exports = { checkAlerts, startAlertScheduler };