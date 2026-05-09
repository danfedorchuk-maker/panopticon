// api/congress.js — Panopticon
// SEC EDGAR Form 4 insider trading data — free, no key required

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = (req.query.q || '').trim().toUpperCase();

  try {
    // Use EDGAR RSS feed for recent Form 4 filings — clean XML, reliable
    const rssUrl = query
      ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(query)}&type=4&dateb=&owner=include&count=40&search_text=&output=atom`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=40&search_text=&output=atom`;

    const rssRes = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Panopticon/1.0 research@panopticon.app' },
      signal: AbortSignal.timeout(10000)
    });

    if (!rssRes.ok) throw new Error(`EDGAR RSS: ${rssRes.status}`);
    const xml = await rssRes.text();
    let trades = parseRSS(xml, query);

    // If company search returns nothing, try full-text search by ticker
    if (trades.length === 0 && query) {
      const ftUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(query)}%22&forms=4&dateRange=custom&startdt=2025-01-01&enddt=2026-12-31`;
      const ftRes = await fetch(ftUrl, {
        headers: { 'User-Agent': 'Panopticon/1.0 research@panopticon.app', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (ftRes.ok) {
        const ftData = await ftRes.json();
        const hits = (ftData.hits && ftData.hits.hits) ? ftData.hits.hits : [];
        trades = hits.slice(0, 20).map(h => {
          const src = h._source || {};
          // Clean up entity name — remove CIK if present
          const rawName = src.display_names ? src.display_names[0] : (src.entity_name || 'Unknown');
          const cleanName = rawName.replace(/\s*\(CIK\s*\d+\)/gi, '').trim();
          return {
            ticker:            query,
            asset_description: src.company_name || cleanName,
            representative:    cleanName,
            transaction_date:  src.file_date || '—',
            type:              'Form 4 — Insider Trade',
            amount:            src.period_of_report || '—',
            party:             'Executive / Director',
            state:             '—',
          };
        });
      }
    }

    return res.status(200).json({ trades, source: 'SEC EDGAR Form 4', count: trades.length });

  } catch (err) {
    return res.status(200).json({ trades: [], source: 'SEC EDGAR Form 4', count: 0, error: err.message });
  }
};

function parseRSS(xml, query) {
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
  const results = [];

  for (const entry of entries.slice(0, 30)) {
    const title    = decodeXML((entry.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '');
    const updated  = (entry.match(/<updated>(.*?)<\/updated>/) || [])[1] || '';
    const summary  = decodeXML((entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1] || '');

    // Title format: "4 - COMPANY NAME (TICKER) (filer name)"
    // Extract company name — everything between "4 - " and first "("
    const companyMatch = title.match(/^4\s*-\s*(.*?)(?:\s*\(|$)/);
    const company = companyMatch ? companyMatch[1].trim() : title.replace(/^4\s*-\s*/, '').trim();

    // Extract ticker from parentheses — usually uppercase 1-5 chars
    const tickerMatch = title.match(/\(([A-Z]{1,5})\)/);
    const ticker = tickerMatch ? tickerMatch[1] : (query || '—');

    // Extract filer name — clean up CIK references
    const filerMatch = title.match(/\([A-Z]{1,5}\)\s*\((.*?)\)/);
    const filerRaw = filerMatch ? filerMatch[1] : '';
    const filer = filerRaw.replace(/\s*\(CIK\s*\d+\)/gi, '').trim() || 'See filing';

    // Extract transaction type from summary
    const typeMatch = summary.match(/transaction type[:\s]*(purchase|sale|grant|exercise|award)/i);
    const txType = typeMatch ? capitalize(typeMatch[1]) : 'Form 4 Filing';

    // Extract shares/value from summary if present
    const sharesMatch = summary.match(/(\d[\d,]+)\s*shares/i);
    const shares = sharesMatch ? sharesMatch[1] : '—';

    if (query && ticker !== query && !company.toUpperCase().includes(query)) continue;

    results.push({
      ticker,
      asset_description: company,
      representative:    filer || 'Insider',
      transaction_date:  updated.slice(0, 10),
      type:              txType,
      amount:            shares !== '—' ? shares + ' shares' : '—',
      party:             'Executive / Director',
      state:             '—',
    });
  }
  return results;
}

function decodeXML(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

module.exports = handler;
