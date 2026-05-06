// api/congress.js — Panopticon
// Congressional stock trades from multiple sources

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const query = (req.query.q || '').trim().toUpperCase();

  // Try multiple sources in order
  const sources = [
    // House Stock Watcher S3 - paginated JSON files
    async () => {
      const url = 'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json';
      const r = await fetch(url, { headers: {'User-Agent':'Mozilla/5.0'}, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`S3: ${r.status}`);
      const data = await r.json();
      return { trades: Array.isArray(data) ? data : [], source: 'House Stock Watcher S3' };
    },
    // Senate Stock Watcher S3
    async () => {
      const url = 'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json';
      const r = await fetch(url, { headers: {'User-Agent':'Mozilla/5.0'}, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`Senate S3: ${r.status}`);
      const data = await r.json();
      return { trades: Array.isArray(data) ? data : [], source: 'Senate Stock Watcher S3' };
    },
    // House Stock Watcher API
    async () => {
      const url = query
        ? `https://housestockwatcher.com/api/transactions/ticker/${query}`
        : `https://housestockwatcher.com/api/transactions`;
      const r = await fetch(url, { headers: {'User-Agent':'Mozilla/5.0'}, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HSW: ${r.status}`);
      const data = await r.json();
      return { trades: Array.isArray(data) ? data : (data.transactions || []), source: 'House Stock Watcher API' };
    },
  ];

  let trades = [];
  let source = 'unavailable';

  for (const fn of sources) {
    try {
      const result = await fn();
      trades = result.trades;
      source = result.source;
      if (trades.length > 0) break;
    } catch (e) {
      continue;
    }
  }

  // Filter by query
  if (query && trades.length > 0) {
    trades = trades.filter(t =>
      (t.ticker || '').toUpperCase() === query ||
      (t.ticker || '').toUpperCase().includes(query) ||
      (t.asset_description || '').toUpperCase().includes(query)
    );
  }

  // Sort and normalize
  trades.sort((a,b) => new Date(b.transaction_date||0) - new Date(a.transaction_date||0));

  const normalized = trades.slice(0,30).map(t => ({
    ticker:            t.ticker || '—',
    asset_description: t.asset_description || t.ticker || '—',
    representative:    t.representative || t.senator || t.name || 'Unknown',
    transaction_date:  t.transaction_date || t.disclosure_date || '—',
    type:              t.type || t.transaction_type || '—',
    amount:            t.amount || '—',
    party:             t.party || '—',
    state:             t.state || '—',
  }));

  return res.status(200).json({ trades: normalized, source, count: normalized.length });
};

module.exports = handler;
