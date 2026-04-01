const axios = require('axios');
const cheerio = require('cheerio');

const request = (url) => axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });

const getStockPrice = async (symbol) => {
  try {
    const res = await request(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`);
    const meta = res.data.chart.result[0].meta;
    return { price: meta.regularMarketPrice, previousClose: meta.previousClose, symbol: meta.symbol };
  } catch {
    throw new Error(`Price unavailable for ${symbol}`);
  }
};

const getStockProfile = async (symbol) => {
  try {
    const res = await request(`https://query2.finance.yahoo.com/v1/finance/search?q=${symbol}`);
    const quote = res.data.quotes.find(q => q.symbol.toUpperCase() === symbol.toUpperCase());
    return { sector: quote?.sector || (quote?.typeDisp === 'cryptocurrency' ? 'Cryptocurrency' : 'Other') };
  } catch {
    return { sector: 'Unknown' };
  }
};

const getStockNews = async (symbol) => {
  try {
    const res = await request(`https://www.google.com/search?q=${symbol}+stock+news&tbm=nws`);
    const $ = cheerio.load(res.data);
    const news = [];
    $('div.BNeawe.vv94Jb.AP7Wnd').each((i, el) => { if (i < 3) news.push($(el).text()); });
    return news.length ? news.join(' | ') : 'No news found';
  } catch {
    return 'News unavailable';
  }
};

module.exports = { getStockPrice, getStockProfile, getStockNews };