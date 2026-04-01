const express = require('express');
const mongoose = require('mongoose');
const { setupBot } = require('./bot');
const { env } = require('./config');
const { startDcaScheduler } = require('./dca-service');
const { startAlertScheduler } = require('./alert-service');

const app = express();
const port = env.port;

app.get('/', (req, res) => res.send('AI Alpha is Live!'));

app.listen(port, '0.0.0.0', async () => {
  try {
    await mongoose.connect(env.mongoUri);
    await setupBot();
    startDcaScheduler();
    startAlertScheduler();
  } catch (error) {
    console.error('BOOT ERROR:', error.message);
  }
});
