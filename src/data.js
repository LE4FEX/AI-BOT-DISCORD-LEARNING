const axios = require('axios');
const cheerio = require('cheerio');

const MARKET_LEADERS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'META', 'GOOGL', 'AMZN', 'NFLX', 'AMD', 'COIN', 'BTC-USD'];

const httpGet = (url, options = {}) => axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000, ...options });

const getMarketSentiment = async () => {
  try {
    const [stockRes, cryptoRes] = await Promise.all([
      httpGet('https://production.dataviz.cnn.io/index/fearandgreed/graphdata'),
      httpGet('https://api.alternative.me/fng/?limit=1'),
    ]);
    return {
      stock: { score: Math.round(stockRes.data.fear_and_greed.score), rating: stockRes.data.fear_and_greed.rating },
      crypto: { score: cryptoRes.data.data[0].value, rating: cryptoRes.data.data[0].value_classification },
    };
  } catch (error) {
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

module.exports = { MARKET_LEADERS, getMarketSentiment, getStockPrice, getStockProfile, getStockNews };