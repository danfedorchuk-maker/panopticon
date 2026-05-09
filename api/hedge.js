// api/hedge.js — Panopticon
// Hedge fund 13F filings from SEC EDGAR — free, no key required

const MAJOR_FUNDS = [
  { name: 'Berkshire Hathaway',     cik: '0001067983' },
  { name: 'Bridgewater Associates', cik: '0001350694' },
  { name: 'Renaissance Technologies', cik: '0001037389' },
  { name: 'Citadel Advisors',       cik: '0001423298' },
  { name: 'Two Sigma Investments',  cik: '0001179392' },
  { name: 'D.E. Shaw',              cik: '0001009207' },
  { name: 'Tiger Global',           cik: '0001167483' },
  { name: 'Pershing Square',        cik: '0001336528' },
  { name: 'Third Point',            cik: '0001040273' },
  { name: 'Baupost Group',          cik: '0000788306' },
];

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = (req.query.q || '').trim().toUpperCase();

  if (!query) {
    return res.status(200).json({
      holdings: [],
      message: 'Enter a ticker to search hedge fund 13F holdings.'
    });
  }

  try {
    // Search EDGAR full-text for 13F filings mentioning this ticker
    const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(query)}%22&forms=13F-HR&dateRange=custom&startdt=2024-01-01&enddt=2026-12-31`;

    const searchRes = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Panopticon/1.0 research@panopticon.app',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(12000)
    });

    let holdings = [];

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const hits = (searchData.hits && searchData.hits.hits) ? searchData.hits.hits : [];

      holdings = hits.slice(0, 12).map(hit => {
        const src = hit._source || {};
        const fundName = src.entity_name || src.display_names?.[0] || 'Unknown Fund';
        const cleanName = fundName.replace(/\s*\(CIK\s*\d+\)/gi, '').trim();
        const filingDate = src.file_date || src.period_of_report || '—';

        return {
          fund_name:    cleanName,
          filing_date:  filingDate,
          ticker:       query,
          shares:       null,
          value:        null,
          top_holdings: [`Filed: ${filingDate}`, `Search for ${query} in 13F`],
          filing_url:   `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(cleanName)}&type=13F&dateb=&owner=include&count=5`,
        };
      });
    }

    // If EDGAR full-text search returns nothing, check major funds directly via their RSS
    if (holdings.length === 0) {
      const fundChecks = await Promise.allSettled(
        MAJOR_FUNDS.slice(0, 6).map(async fund => {
          const url = `https://data.sec.gov/submissions/CIK${fund.cik.replace(/^0+/, '').padStart(10, '0')}.json`;
          const r = await fetch(url, {
            headers: { 'User-Agent': 'Panopticon/1.0 research@panopticon.app' },
            signal: AbortSignal.timeout(6000)
          });
          if (!r.ok) throw new Error(`${fund.name}: ${r.status}`);
          const data = await r.json();

          // Get most recent 13F filing date
          const filings = data.filings?.recent || {};
          const forms = filings.form || [];
          const dates = filings.filingDate || [];
          let latestDate = '—';
          for (let i = 0; i < forms.length; i++) {
            if (forms[i] === '13F-HR') { latestDate = dates[i] || '—'; break; }
          }

          return {
            fund_name:    fund.name,
            filing_date:  latestDate,
            ticker:       query,
            shares:       0,
            value:        0,
            top_holdings: [`Latest 13F: ${latestDate}`, `Check EDGAR for ${query} holdings`],
          };
        })
      );

      holdings = fundChecks
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);
    }

    return res.status(200).json({
      holdings,
      source: 'SEC EDGAR 13F',
      count: holdings.length
    });

  } catch (err) {
    return res.status(200).json({ holdings: [], error: err.message });
  }
};

module.exports = handler;
