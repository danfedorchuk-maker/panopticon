// api/canada.js — Panopticon
// Canadian federal contracts from open.canada.ca
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

  try {
    // Use SQL search for vendor name — more precise than full-text q= param
    const sqlUrl = `https://open.canada.ca/data/en/api/3/action/datastore_search_sql?sql=SELECT%20*%20FROM%20%22fac950c0-00d5-4ec1-a4d3-9cbebf98a305%22%20WHERE%20vendor_name%20ILIKE%20%27%25${encodeURIComponent(query.replace(/'/g, "''"))}%25%27%20ORDER%20BY%20contract_date%20DESC%20LIMIT%2020`;

    const r = await fetch(sqlUrl, {
      headers: {
        'User-Agent': 'Panopticon/1.0 research@panopticon.app',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(25000)
    });

    if (!r.ok) throw new Error(`open.canada.ca SQL: ${r.status}`);
    const data = await r.json();
    if (!data.success) throw new Error('SQL query failed: ' + JSON.stringify(data.error));

    const records = data.result?.records || [];

    const contracts = records.map(rec => ({
      vendor_name:    rec.vendor_name        || 'Unknown',
      department:     rec.department_name_en || rec.owner_org || '—',
      contract_date:  rec.contract_date      || '—',
      description_en: rec.description_en     || rec.comments_en || '—',
      contract_value: parseFloat(rec.contract_value || rec.original_value || 0),
      end_date:       rec.expiry_date        || '—',
    }));

    contracts.sort((a, b) => b.contract_value - a.contract_value);

    // If SQL returns nothing, fall back to q= full text search
    if (contracts.length === 0) {
      const ftUrl = `https://open.canada.ca/data/en/api/3/action/datastore_search?resource_id=fac950c0-00d5-4ec1-a4d3-9cbebf98a305&q=${encodeURIComponent(query)}&limit=20`;
      const ftR = await fetch(ftUrl, {
        headers: { 'User-Agent': 'Panopticon/1.0 research@panopticon.app', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(25000)
      });
      if (ftR.ok) {
        const ftData = await ftR.json();
        const ftRecords = ftData.result?.records || [];
        const ftContracts = ftRecords.map(rec => ({
          vendor_name:    rec.vendor_name        || 'Unknown',
          department:     rec.department_name_en || rec.owner_org || '—',
          contract_date:  rec.contract_date      || '—',
          description_en: rec.description_en     || rec.comments_en || '—',
          contract_value: parseFloat(rec.contract_value || rec.original_value || 0),
          end_date:       rec.expiry_date        || '—',
        }));
        ftContracts.sort((a, b) => b.contract_value - a.contract_value);
        return res.status(200).json({
          contracts: ftContracts,
          source: 'Government of Canada Open Data',
          count: ftContracts.length
        });
      }
    }

    return res.status(200).json({
      contracts,
      source: 'Government of Canada Open Data',
      count: contracts.length
    });

  } catch (err) {
    return res.status(200).json({
      contracts: [],
      source: 'Government of Canada Open Data',
      count: 0,
      error: err.message
    });
  }
};

module.exports = handler;
