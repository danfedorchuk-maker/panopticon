// api/congress.js — Panopticon
// Replaced congressional trades with SEC EDGAR Form 4 insider trading data
// Official free API — no key required, just a User-Agent header

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = (req.query.q || '').trim().toUpperCase();

  try {
    let url;

    if (query) {
      // Search by ticker symbol using EDGAR full-text search
      url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(query)}%22&dateRange=custom&startdt=2025-01-01&enddt=2026-12-31&forms=4`;
    } else {
      // Recent Form 4 filings across all companies
      url = `https://efts.sec.gov/LATEST/search-index?q=%22form+4%22&forms=4&dateRange=custom&startdt=2026-04-01&enddt=2026-12-31`;
    }

    const searchRes = await fetch(url, {
      headers: {
        'User-Agent': 'Panopticon/1.0 research@panopticon.app',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!searchRes.ok) throw new Error(`EDGAR search: ${searchRes.status}`);
    const searchData = await searchRes.json();
    const hits = (searchData.hits && searchData.hits.hits) ? searchData.hits.hits : [];

    // Also fetch recent filings from EDGAR submissions endpoint if we have a ticker
    let trades = [];

    if (query && hits.length === 0) {
      // Try the EDGAR company search to get CIK first
      const tickerRes = await fetch(
        `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(query)}%22&forms=4`,
        {
          headers: { 'User-Agent': 'Panopticon/1.0 research@panopticon.app' },
          signal: AbortSignal.timeout(8000)
        }
      );
      if (tickerRes.ok) {
        const tickerData = await tickerRes.json();
        const tickerHits = (tickerData.hits && tickerData.hits.hits) ? tickerData.hits.hits : [];
        trades = normalizeHits(tickerHits, query);
      }
    } else {
      trades = normalizeHits(hits, query);
    }

    // If still empty, fetch the latest Form 4 filings from EDGAR RSS
    if (trades.length === 0) {
      try {
        const rssRes = await fetch(
          'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=40&search_text=&output=atom',
          {
            headers: { 'User-Agent': 'Panopticon/1.0 research@panopticon.app' },
            signal: AbortSignal.timeout(8000)
          }
        );
        if (rssRes.ok) {
          const xml = await rssRes.text();
          trades = parseRSS(xml, query);
        }
      } catch(e) {
        // RSS fallback failed, continue with empty
      }
    }

    return res.status(200).json({
      trades,
      source: 'SEC EDGAR Form 4',
      count: trades.length
    });

  } catch (err) {
    return res.status(200).json({
      trades: [],
      source: 'SEC EDGAR Form 4',
      count: 0,
      error: err.message
    });
  }
};

function normalizeHits(hits, query) {
  return hits.slice(0, 30).map(h => {
    const src = h._source || {};
    const ticker = src.period_of_report || '';
    const filer = src.display_names ? src.display_names[0] : (src.entity_name || 'Unknown');
    const filed = src.file_date || src.period_of_report || '';
    return {
      ticker:            query || src.ticker || '—',
      asset_description: src.company_name || src.entity_name || filer || '—',
      representative:    filer,
      transaction_date:  filed,
      type:              src.form_type || 'Form 4',
      amount:            src.file_num || '—',
      party:             'Executive/Director',
      state:             '—',
      url:               src.file_date ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(src.entity_name||'')}&type=4&dateb=&owner=include&count=10` : ''
    };
  });
}

function parseRSS(xml, query) {
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
  const results = [];
  for (const entry of entries.slice(0, 30)) {
    const title   = (entry.match(/<title>(.*?)<\/title>/) || [])[1] || '';
    const updated = (entry.match(/<updated>(.*?)<\/updated>/) || [])[1] || '';
    const link    = (entry.match(/href="(.*?)"/) || [])[1] || '';
    const summary = (entry.match(/<summary.*?>([\s\S]*?)<\/summary>/) || [])[1] || '';

    // Title format: "4 - COMPANY NAME (ticker) (filer name)"
    const tickerMatch = title.match(/\(([A-Z]{1,5})\)/);
    const ticker = tickerMatch ? tickerMatch[1] : '—';
    const companyMatch = title.match(/4 - (.*?)\(/);
    const company = companyMatch ? companyMatch[1].trim() : title;

    if (query && ticker !== query && !company.toUpperCase().includes(query)) continue;

    results.push({
      ticker,
      asset_description: company,
      representative:    summary.replace(/<[^>]+>/g, '').trim().slice(0, 80) || 'SEC Filing',
      transaction_date:  updated.slice(0, 10),
      type:              'Form 4 — Insider Trade',
      amount:            '—',
      party:             'Executive/Director',
      state:             '—',
      url:               link
    });
  }
  return results;
}

module.exports = handler;
