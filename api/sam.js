// api/sam.js — Panopticon
// Fetches US government contract awards from SAM.gov
// Requires SAM_API_KEY environment variable (free from api.data.gov)

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const query   = (req.query.q || '').trim();
  const apiKey  = process.env.SAM_API_KEY;

  if (!query) {
    return res.status(200).json({ contracts: [], message: 'Enter a company name to search US contracts.' });
  }

  if (!apiKey) {
    return res.status(200).json({ contracts: [], error: 'SAM_API_KEY not configured.' });
  }

  try {
    // SAM.gov Contract Opportunities API
    // Also try the Contract Awards (FPDS) data
    const url = `https://api.sam.gov/prod/opportunities/v2/search?api_key=${apiKey}&keyword=${encodeURIComponent(query)}&limit=10&postedFrom=01/01/2024&postedTo=12/31/2026`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Panopticon/1.0' },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      // Try contract awards endpoint
      const awardsUrl = `https://api.usaspending.gov/api/v2/search/spending_by_award/`;
      const awardsRes = await fetch(awardsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Panopticon/1.0' },
        body: JSON.stringify({
          filters: {
            keywords: [query],
            award_type_codes: ['A','B','C','D'],
            time_period: [{ start_date: '2024-01-01', end_date: '2026-12-31' }]
          },
          fields: ['Award ID','Recipient Name','Awarding Agency','Award Amount','Start Date','Description'],
          sort: 'Award Amount',
          order: 'desc',
          limit: 10,
          page: 1
        }),
        signal: AbortSignal.timeout(12000)
      });

      if (awardsRes.ok) {
        const awardsData = await awardsRes.json();
        const results = awardsData.results || [];
        const contracts = results.map(r => ({
          vendorName:  r['Recipient Name'] || 'Unknown',
          agencyName:  r['Awarding Agency'] || '—',
          award_date:  r['Start Date'] || '—',
          description: r['Description'] || '—',
          award_amount: r['Award Amount'] || 0,
          award_id:    r['Award ID'] || '—',
        }));
        return res.status(200).json({ contracts, source: 'USASpending.gov', count: contracts.length });
      }

      throw new Error(`SAM API: ${response.status}`);
    }

    const data = await response.json();
    const opps = data.opportunitiesData || data.results || [];

    const contracts = opps.map(o => ({
      vendorName:  o.awardee?.name || o.title || 'TBD',
      agencyName:  o.fullParentPathName || o.departmentName || '—',
      award_date:  o.postedDate || o.responseDeadLine || '—',
      description: o.title || o.description || '—',
      award_amount: o.baseAndAllOptionsValue || 0,
      naicsCode:   o.naicsCode || '—',
    }));

    return res.status(200).json({ contracts, source: 'SAM.gov', count: contracts.length });

  } catch (err) {
    // Fallback to USASpending.gov — no key required
    try {
      const spendingRes = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            keywords: [query],
            award_type_codes: ['A','B','C','D'],
            time_period: [{ start_date: '2023-01-01', end_date: '2026-12-31' }]
          },
          fields: ['Award ID','Recipient Name','Awarding Agency','Award Amount','Start Date','Description'],
          sort: 'Award Amount',
          order: 'desc',
          limit: 10,
          page: 1
        }),
        signal: AbortSignal.timeout(12000)
      });

      if (spendingRes.ok) {
        const spendingData = await spendingRes.json();
        const results = spendingData.results || [];
        const contracts = results.map(r => ({
          vendorName:  r['Recipient Name'] || 'Unknown',
          agencyName:  r['Awarding Agency'] || '—',
          award_date:  r['Start Date'] || '—',
          description: r['Description'] || '—',
          award_amount: r['Award Amount'] || 0,
        }));
        return res.status(200).json({ contracts, source: 'USASpending.gov (fallback)', count: contracts.length });
      }
    } catch {}

    return res.status(200).json({ contracts: [], error: err.message });
  }
};

module.exports = handler;
