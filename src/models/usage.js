const mongoose = require('mongoose');

const usageSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // Format: YYYY-MM-DD
  primaryCount: { type: Number, default: 0 }, // สถิติ Gemini 3.1 Flash-Lite
  backupCount: { type: Number, default: 0 }   // สถิติ Gemini 2.5 Flash
});

module.exports = mongoose.models.Usage || mongoose.model('Usage', usageSchema);
