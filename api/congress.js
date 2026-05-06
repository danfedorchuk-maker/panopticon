// api/congress.js — Panopticon
// Fetches congressional stock trade disclosures from House Stock Watcher API
// Free, no key required, updated daily

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const query = (req.query.q || '').trim().toUpperCase();

  try {
    // House Stock Watcher API — returns recent trades, optionally filtered by ticker
    const url = query
      ? `https://housestockwatcher.com/api/transactions/ticker/${query}`
      : `https://housestockwatcher.com/api/transactions`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Panopticon/1.0' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) throw new Error(`House Stock Watcher: ${response.status}`);
    const data = await response.json();

    // Normalize the data
    let trades = Array.isArray(data) ? data : (data.transactions || data.data || []);

    // If not searching by ticker, filter by company name if query provided
    if (query && !url.includes('/ticker/')) {
      trades = trades.filter(t =>
        (t.asset_description || '').toLowerCase().includes(query.toLowerCase()) ||
        (t.ticker || '').toUpperCase().includes(query)
      );
    }

    // Sort by most recent first
    trades.sort((a, b) => new Date(b.transaction_date || 0) - new Date(a.transaction_date || 0));

    // Normalize fields
    const normalized = trades.slice(0, 50).map(t => ({
      ticker:           t.ticker || '—',
      asset_description: t.asset_description || t.ticker || '—',
      representative:   t.representative || t.name || 'Unknown',
      transaction_date: t.transaction_date || t.disclosure_date || '—',
      type:             t.type || t.transaction_type || '—',
      amount:           t.amount || '—',
      party:            t.party || '—',
      state:            t.state || '—',
      district:         t.district || '—',
    }));

    return res.status(200).json({ trades: normalized, source: 'House Stock Watcher', count: normalized.length });

  } catch (err) {
    // Fallback: try Senate Stock Watcher if House fails
    try {
      const senateUrl = query
        ? `https://senatestockwatcher.com/api/transactions/ticker/${query}`
        : `https://senatestockwatcher.com/api/transactions`;

      const senateRes = await fetch(senateUrl, {
        headers: { 'User-Agent': 'Panopticon/1.0' },
        signal: AbortSignal.timeout(8000)
      });

      if (senateRes.ok) {
        const senateData = await senateRes.json();
        let trades = Array.isArray(senateData) ? senateData : (senateData.transactions || []);
        trades.sort((a,b) => new Date(b.transaction_date||0) - new Date(a.transaction_date||0));
        const normalized = trades.slice(0,50).map(t => ({
          ticker:           t.ticker || '—',
          asset_description: t.asset_description || t.ticker || '—',
          senator:          t.senator || t.name || 'Unknown',
          transaction_date: t.transaction_date || '—',
          type:             t.type || '—',
          amount:           t.amount || '—',
        }));
        return res.status(200).json({ trades: normalized, source: 'Senate Stock Watcher', count: normalized.length });
      }
    } catch {}

    return res.status(200).json({ trades: [], error: err.message, source: 'Congressional API unavailable' });
  }
};

module.exports = handler;
