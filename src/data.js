const axios = require('axios');
const cheerio = require('cheerio');

const MARKET_LEADERS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'META', 'GOOGL', 'AMZN', 'NFLX', 'AMD', 'COIN', 'BTC-USD'];

const httpGet = (url, options = {}) => axios.get(url, { 
  headers: { 
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json'
  }, 
  timeout: 8000, 
  ...options 
});

const getMarketSentiment = async () => {
  try {
    const [stockRes, cryptoRes] = await Promise.all([
      httpGet('https://production.dataviz.cnn.io/index/fearandgreed/graphdata'),
      httpGet('https://api.alternative.me/fng/?limit=1'),
    ]);
    
    if (!stockRes.data?.fear_and_greed || !cryptoRes.data?.data?.[0]) {
      console.error('[Sentiment] Invalid data structure');
      return null;
    }

    return {
      stock: { 
        score: Math.round(stockRes.data.fear_and_greed.score), 
        rating: stockRes.data.fear_and_greed.rating 
      },
      crypto: { 
        score: cryptoRes.data.data[0].value, 
        rating: cryptoRes.data.data[0].value_classification 
      },
    };
  } catch (error) {
    console.error('[Sentiment] Error fetching:', error.message);
    return null;
  }
};

const getStockPrice = async (symbol) => {
  const res = await httpGet(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`);
  const meta = res.data.chart.result[0].meta;
  return { price: meta.regularMarketPrice, previousClose: meta.previousClose, symbol: meta.symbol };
};

const getStockProfile = async (symbol) => {
  try {
    const res = await httpGet(`https://query2.finance.yahoo.com/v1/finance/search?q=${symbol}`);
    const quote = res.data.quotes.find((q) => q.symbol.toUpperCase() === symbol.toUpperCase());
    return { sector: quote?.sector || (quote?.typeDisp === 'cryptocurrency' ? 'Cryptocurrency' : 'Other') };
  } catch (error) {
    return { sector: 'Unknown' };
  }
};

const getStockNews = async (symbol) => {
  try {
    const res = await httpGet(`https://www.google.com/search?q=${symbol}+stock+news&tbm=nws`);
    const $ = cheerio.load(res.data);
    const news = [];
    $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => {
      if (i < 3) news.push($(el).text());
    });
    return news.length ? news.join(' | ') : 'No news found';
  } catch (error) {
    return 'News unavailable';
  }
};

const getStockHistory = async (symbol, range = '1mo', interval = '1d') => {
  try {
    const res = await httpGet(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`);
    const chart = res.data.chart.result[0];
    return chart.indicators.quote[0].close;
  } catch (error) {
    console.error(`[History] Error fetching ${symbol}:`, error.message);
    return [];
  }
};

const calculateRSI = (prices, period = 14) => {
  if (prices.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }
  return 100 - (100 / (1 + avgGain / avgLoss));
};

const calculateEMA = (prices, period) => {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
};

module.exports = { MARKET_LEADERS, getMarketSentiment, getStockPrice, getStockProfile, getStockNews, getStockHistory, calculateRSI, calculateEMA };