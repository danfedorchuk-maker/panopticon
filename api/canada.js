// api/canada.js — Panopticon
// Canadian federal contracts from open.canada.ca proactive disclosure
// Free, no key required

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = (req.query.q || '').trim();

  if (!query) {
    return res.status(200).json({
      contracts: [],
      message: 'Enter a company name to search Canadian federal contracts.'
    });
  }

  // Try multiple endpoints in order
  const sources = [
    // Primary: Open Canada CKAN datastore search
    async () => {
      const url = `https://open.canada.ca/data/en/api/3/action/datastore_search?resource_id=fac950c0-00d5-4ec1-a4d3-9cbebf98a305&q=${encodeURIComponent(query)}&limit=15&sort=contract_date+desc`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Panopticon/1.0 research@panopticon.app', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      if (!r.ok) throw new Error(`open.canada.ca: ${r.status}`);
      const data = await r.json();
      if (!data.success) throw new Error('API returned success:false');
      const records = data.result?.records || [];
      if (records.length === 0) throw new Error('No records');
      return records.map(r => ({
        vendor_name:    r.vendor_name        || r.supplier_name  || 'Unknown',
        department:     r.department_name_en || r.owner_org      || '—',
        contract_date:  r.contract_date      || r.award_date     || '—',
        description_en: r.description_en     || r.comments_en    || '—',
        contract_value: parseFloat(r.contract_value || r.original_value || 0),
        end_date:       r.expiry_date        || '—',
      }));
    },

    // Fallback: search.open.canada.ca Solr endpoint
    async () => {
      const url = `https://search.open.canada.ca/contracts/?q=${encodeURIComponent(query)}&sort=contract_value+desc&page=1&format=json`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Panopticon/1.0 research@panopticon.app', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(12000)
      });
      if (!r.ok) throw new Error(`search.open.canada.ca: ${r.status}`);
      const data = await r.json();
      const hits = data.hits?.hits || data.results || [];
      if (hits.length === 0) throw new Error('No results');
      return hits.slice(0, 15).map(h => {
        const s = h._source || h;
        return {
          vendor_name:    s.vendor_name    || s.supplier_name  || 'Unknown',
          department:     s.owner_org_title_en || s.department || '—',
          contract_date:  s.contract_date  || s.award_date     || '—',
          description_en: s.description_en || s.comments_en   || '—',
          contract_value: parseFloat(s.contract_value || s.original_value || 0),
          end_date:       s.expiry_date    || '—',
        };
      });
    },

    // Second fallback: CKAN full-text search with filters
    async () => {
      const url = `https://open.canada.ca/data/en/api/3/action/datastore_search_sql?sql=SELECT * from "fac950c0-00d5-4ec1-a4d3-9cbebf98a305" WHERE vendor_name ILIKE '%25${encodeURIComponent(query)}%25' ORDER BY contract_date DESC LIMIT 15`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Panopticon/1.0 research@panopticon.app' },
        signal: AbortSignal.timeout(15000)
      });
      if (!r.ok) throw new Error(`CKAN SQL: ${r.status}`);
      const data = await r.json();
      if (!data.success) throw new Error('SQL query failed');
      const records = data.result?.records || [];
      if (records.length === 0) throw new Error('No SQL records');
      return records.map(r => ({
        vendor_name:    r.vendor_name        || 'Unknown',
        department:     r.department_name_en || r.owner_org || '—',
        contract_date:  r.contract_date      || '—',
        description_en: r.description_en     || '—',
        contract_value: parseFloat(r.contract_value || 0),
        end_date:       r.expiry_date        || '—',
      }));
    },
  ];

  let contracts = [];
  let source = 'Government of Canada Open Data';
  let lastError = '';

  for (const fn of sources) {
    try {
      const records = await fn();
      contracts = records;
      if (contracts.length > 0) break;
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }

  // Sort by value descending
  contracts.sort((a, b) => b.contract_value - a.contract_value);

  return res.status(200).json({
    contracts,
    source,
    count: contracts.length,
    ...(contracts.length === 0 && { error: lastError })
  });
};

module.exports = handler;
