// api/debug.js — tests all external connections
const handler = async (req, res) => {
  const results = {};
  
  const tests = [
    ['house_s3', 'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json'],
    ['senate_s3', 'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json'],
    ['housestockwatcher', 'https://housestockwatcher.com/api/transactions'],
    ['usaspending', 'https://api.usaspending.gov/api/v2/agency/'],
    ['canada_open', 'https://open.canada.ca/data/en/api/3/action/package_list?limit=1'],
    ['sec_edgar', 'https://efts.sec.gov/LATEST/search-index?q=palantir&forms=13F-HR&hits.hits.total=true'],
  ];

  for (const [name, url] of tests) {
    try {
      const r = await fetch(url, { 
        signal: AbortSignal.timeout(8000),
        headers: {'User-Agent': 'Mozilla/5.0'}
      });
      const text = await r.text();
      results[name] = { status: r.status, ok: r.ok, size: text.length, preview: text.slice(0,100) };
    } catch(e) {
      results[name] = { error: e.message };
    }
  }

  return res.status(200).json(results);
};
module.exports = handler;
