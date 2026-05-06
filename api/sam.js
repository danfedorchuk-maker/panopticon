// api/sam.js — Panopticon
// Fetches US government contracts from USASpending.gov (no key needed)
// and SAM.gov as fallback

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const query = (req.query.q || '').trim();

  if (!query) {
    return res.status(200).json({ contracts: [], message: 'Enter a company name.' });
  }

  try {
    // USASpending.gov — completely free, no key, best data
    const body = {
      filters: {
        keywords: [query],
        award_type_codes: ['A','B','C','D'],
        time_period: [{ start_date: '2023-01-01', end_date: '2026-12-31' }]
      },
      fields: ['Award ID','Recipient Name','Awarding Agency','Award Amount','Start Date','Description','Recipient State Code'],
      sort: 'Award Amount',
      order: 'desc',
      limit: 15,
      page: 1
    };

    const response = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Panopticon/1.0' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) throw new Error(`USASpending: ${response.status}`);
    const data = await response.json();
    const results = data.results || [];

    const contracts = results.map(r => ({
      vendorName:   r['Recipient Name'] || 'Unknown',
      agencyName:   r['Awarding Agency'] || '—',
      award_date:   r['Start Date'] || '—',
      description:  r['Description'] || '—',
      award_amount: r['Award Amount'] || 0,
      award_id:     r['Award ID'] || '—',
      state:        r['Recipient State Code'] || '—',
    }));

    return res.status(200).json({ contracts, source: 'USASpending.gov', count: contracts.length });

  } catch (err) {
    return res.status(200).json({ contracts: [], error: err.message });
  }
};

module.exports = handler;
