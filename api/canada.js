// api/canada.js — Panopticon
// Fetches Canadian federal contract awards from the Open Government Portal
// Free, no key required

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const query = (req.query.q || '').trim();

  if (!query) {
    return res.status(200).json({ contracts: [], message: 'Enter a company name to search Canadian contracts.' });
  }

  try {
    // Canada Open Government proactive disclosure contracts API
    // Dataset: contracts proactive disclosure
    const url = `https://open.canada.ca/data/en/api/3/action/datastore_search?resource_id=fac950c0-00d5-4ec1-a4d3-9cbebf98a305&q=${encodeURIComponent(query)}&limit=15&sort=contract_date%20desc`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Panopticon/1.0' },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) throw new Error(`Canada API: ${response.status}`);

    const data = await response.json();
    const records = data.result?.records || [];

    const contracts = records.map(r => ({
      vendor_name:   r.vendor_name        || r.supplier_name || 'Unknown',
      department:    r.department_name_en || r.owner_org     || '—',
      contract_date: r.contract_date      || r.award_date    || '—',
      description:   r.description_en     || r.comments_en   || '—',
      contract_value: parseFloat(r.contract_value || r.original_value || 0),
      commodity:     r.commodity_type     || '—',
      end_date:      r.expiry_date        || '—',
    }));

    // Sort by contract value descending
    contracts.sort((a,b) => b.contract_value - a.contract_value);

    return res.status(200).json({
      contracts,
      source: 'Government of Canada Open Data',
      count: contracts.length
    });

  } catch (err) {
    // Fallback: try the buyandsell search API
    try {
      const fallbackUrl = `https://buyandsell.gc.ca/procurement-data/contract-history?q=${encodeURIComponent(query)}&format=json`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { 'User-Agent': 'Panopticon/1.0' },
        signal: AbortSignal.timeout(8000)
      });
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        const contracts = (fallbackData.results || []).slice(0,15).map(r => ({
          vendor_name:    r.supplier || r.vendor || 'Unknown',
          department:     r.department || '—',
          contract_date:  r.date || '—',
          description:    r.description || '—',
          contract_value: parseFloat(r.value || 0),
        }));
        return res.status(200).json({ contracts, source: 'BuyAndSell.gc.ca', count: contracts.length });
      }
    } catch {}

    return res.status(200).json({ contracts: [], error: err.message });
  }
};

module.exports = handler;
