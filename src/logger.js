const logs = [];
const MAX_LOGS = 50;

const log = (message, type = 'info') => {
  const entry = {
    timestamp: new Date(),
    message,
    type
  };
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.pop();
  
  // Also print to console
  const timestamp = entry.timestamp.toLocaleTimeString();
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
};

module.exports = {
  log,
  getLogs: () => logs
};
