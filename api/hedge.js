// api/hedge.js — Panopticon
// Parses actual 13F holdings XML from SEC EDGAR — real shares and values
// Free, no key required

const MAJOR_FUNDS = [
  { name: 'Berkshire Hathaway',      cik: '0001067983' },
  { name: 'Bridgewater Associates',  cik: '0001350694' },
  { name: 'Renaissance Technologies',cik: '0001037389' },
  { name: 'Citadel Advisors',        cik: '0001423298' },
  { name: 'Two Sigma Investments',   cik: '0001179392' },
  { name: 'D.E. Shaw',               cik: '0001009207' },
  { name: 'Tiger Global',            cik: '0001167483' },
  { name: 'Pershing Square',         cik: '0001336528' },
  { name: 'Third Point',             cik: '0001040273' },
  { name: 'Baupost Group',           cik: '0000788306' },
];

const HEADERS = {
  'User-Agent': 'Panopticon/1.0 research@panopticon.app',
  'Accept': 'application/json'
};

// Fetch the latest 13F filing accession number for a fund
async function getLatest13F(cik) {
  const paddedCik = cik.replace(/^0+/, '').padStart(10, '0');
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`submissions: ${r.status}`);
  const data = await r.json();

  const filings = data.filings?.recent || {};
  const forms       = filings.form         || [];
  const accessions  = filings.accessionNumber || [];
  const dates       = filings.filingDate   || [];
  const periods     = filings.reportDate   || [];

  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === '13F-HR') {
      return {
        accession:   accessions[i],
        filingDate:  dates[i],
        periodDate:  periods[i],
      };
    }
  }
  throw new Error('No 13F-HR found');
}

// Fetch the holdings XML/text file from within the filing
async function getHoldingsXML(cik, accession) {
  const paddedCik = cik.replace(/^0+/, '').padStart(10, '0');
  const accDashes = accession.replace(/\./g, '-');
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(paddedCik, 10)}/${accession.replace(/-/g, '')}/`;

  // Get the filing index to find the infotable XML file
  const idxUrl = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
  // Direct approach: try common filename patterns
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(paddedCik, 10)}/${accession.replace(/-/g, '')}/`;

  // Fetch the filing index page
  const idxPageUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}&type=13F-HR&dateb=&owner=include&count=1&search_text=&output=atom`;
  
  // Try fetching the filing index JSON
  const filingIndexUrl = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
  
  // Get the actual document list for this accession
  const docListUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(paddedCik, 10)}/${accession.replace(/-/g, '')}/${accDashes}-index.json`;
  
  const docListRes = await fetch(docListUrl, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: AbortSignal.timeout(8000) });
  if (!docListRes.ok) throw new Error(`doc index: ${docListRes.status}`);
  const docList = await docListRes.json();

  // Find the infotable (holdings) file
  const files = docList.directory?.item || [];
  let holdingsFile = null;
  for (const f of files) {
    const name = (f.name || '').toLowerCase();
    if (name.includes('infotable') || name.endsWith('.xml') && name !== 'primary_doc.xml') {
      holdingsFile = f.name;
      break;
    }
  }
  if (!holdingsFile) {
    // Try the first XML file that isn't the primary doc
    for (const f of files) {
      if ((f.name || '').toLowerCase().endsWith('.xml')) {
        holdingsFile = f.name;
        break;
      }
    }
  }
  if (!holdingsFile) throw new Error('No holdings file found');

  const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(paddedCik, 10)}/${accession.replace(/-/g, '')}/${holdingsFile}`;
  const xmlRes = await fetch(xmlUrl, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: AbortSignal.timeout(10000) });
  if (!xmlRes.ok) throw new Error(`holdings XML: ${xmlRes.status}`);
  return await xmlRes.text();
}

// Parse holdings XML and search for ticker/company
function parseHoldings(xml, query) {
  // Extract all infoTable entries
  const entries = xml.match(/<infoTable>([\s\S]*?)<\/infoTable>/gi) || [];
  const results = [];

  for (const entry of entries) {
    const nameMatch    = entry.match(/<nameOfIssuer>(.*?)<\/nameOfIssuer>/i);
    const sharesMatch  = entry.match(/<sshPrnamt>(.*?)<\/sshPrnamt>/i);
    const valueMatch   = entry.match(/<value>(.*?)<\/value>/i);
    const tickerMatch  = entry.match(/<cusip>(.*?)<\/cusip>/i);
    const typeMatch    = entry.match(/<sshPrnamtType>(.*?)<\/sshPrnamtType>/i);

    const name   = (nameMatch   ? nameMatch[1]   : '').trim();
    const shares = sharesMatch  ? parseInt(sharesMatch[1].replace(/,/g, ''), 10)  : 0;
    const value  = valueMatch   ? parseInt(valueMatch[1].replace(/,/g, ''), 10)   : 0; // in $thousands
    const cusip  = tickerMatch  ? tickerMatch[1].trim() : '';
    const type   = typeMatch    ? typeMatch[1].trim()   : 'SH';

    if (!name) continue;

    // Match by company name containing query
    if (name.toUpperCase().includes(query)) {
      results.push({ name, shares, value: value * 1000, cusip, type });
    }
  }
  return results;
}

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = (req.query.q || '').trim().toUpperCase();

  if (!query) {
    return res.status(200).json({
      holdings: [],
      message: 'Enter a company name or ticker to search hedge fund 13F holdings.'
    });
  }

  // Check up to 6 major funds in parallel
  const fundResults = await Promise.allSettled(
    MAJOR_FUNDS.slice(0, 6).map(async fund => {
      const { accession, filingDate, periodDate } = await getLatest13F(fund.cik);
      const xml = await getHoldingsXML(fund.cik, accession);
      const matches = parseHoldings(xml, query);
      return { fund, filingDate, periodDate, matches };
    })
  );

  const holdings = [];

  for (const result of fundResults) {
    if (result.status !== 'fulfilled') continue;
    const { fund, filingDate, periodDate, matches } = result.value;

    if (matches.length > 0) {
      for (const m of matches) {
        holdings.push({
          fund_name:   fund.name,
          filing_date: filingDate,
          period:      periodDate,
          ticker:      query,
          name:        m.name,
          shares:      m.shares,
          value:       m.value,
          type:        m.type,
          top_holdings: [
            `${m.shares.toLocaleString()} shares`,
            `$${(m.value / 1e6).toFixed(1)}M value`,
            `Period: ${periodDate}`
          ]
        });
      }
    }
  }

  // Sort by value descending
  holdings.sort((a, b) => b.value - a.value);

  return res.status(200).json({
    holdings,
    source: 'SEC EDGAR 13F',
    count: holdings.length
  });
};

module.exports = handler;
