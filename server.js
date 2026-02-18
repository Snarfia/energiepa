const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';

const RIJKSOVERHEID_RSS = 'https://feeds.rijksoverheid.nl/onderwerpen/duurzame-energie/documenten.rss';
const TWEEDEKAMER_ODATA = 'https://gegevensmagazijn.tweedekamer.nl/OData/v4/2.0/Activiteit';

const ENERGY_KEYWORDS = [
  'energie',
  'klimaat',
  'duurzaam',
  'waterstof',
  'elektriciteit',
  'stroom',
  'gas',
  'co2',
  'emissie',
  'netcongestie',
  'wind',
  'zon',
  'warmte',
  'kernenergie'
];

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bestand niet gevonden');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function decodeXmlEntities(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractTagValue(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'));
  return match ? decodeXmlEntities(match[1]) : '';
}

function parseRssItems(xml) {
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
  return itemBlocks.map((itemBlock) => {
    const title = extractTagValue(itemBlock, 'title');
    const link = extractTagValue(itemBlock, 'link');
    const description = extractTagValue(itemBlock, 'description');
    const pubDateRaw = extractTagValue(itemBlock, 'pubDate');
    const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;

    return {
      title,
      link,
      description,
      pubDate: pubDate && !Number.isNaN(pubDate.getTime()) ? pubDate.toISOString() : null
    };
  });
}

function getStartOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getStartOfWeek() {
  const todayStart = getStartOfToday();
  const day = todayStart.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(todayStart);
  monday.setDate(todayStart.getDate() + mondayOffset);
  return monday;
}

function isInSelectedRange(dateIso, range) {
  if (!dateIso) return false;
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return false;

  const start = range === 'today' ? getStartOfToday() : getStartOfWeek();
  return date >= start;
}

function hasEnergyKeyword(text) {
  const normalized = (text || '').toLowerCase();
  return ENERGY_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function toTweedeKamerUrl(nummer, soort) {
  const normalized = (soort || '').toLowerCase();
  if (!nummer) return 'https://www.tweedekamer.nl/debat_en_vergadering';

  if (normalized.includes('plenair') || normalized.includes('stemmingen') || normalized.includes('vragenuur')) {
    return `https://www.tweedekamer.nl/debat_en_vergadering/plenaire_vergaderingen/details/activiteit?id=${encodeURIComponent(nummer)}`;
  }

  return `https://www.tweedekamer.nl/debat_en_vergadering/commissievergaderingen/details?id=${encodeURIComponent(nummer)}`;
}

async function getRijksoverheidPublicaties(range) {
  const response = await fetch(RIJKSOVERHEID_RSS, {
    headers: { 'User-Agent': 'energy-dashboard/1.0' }
  });

  if (!response.ok) {
    throw new Error(`Rijksoverheid RSS fout: ${response.status}`);
  }

  const xml = await response.text();
  const allItems = parseRssItems(xml);

  const items = allItems
    .filter((item) => isInSelectedRange(item.pubDate, range))
    .sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1))
    .slice(0, 25);

  return items;
}

function toODataDateTimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00Z`;
}

async function getTweedeKamerDebatten() {
  const now = new Date();
  const start = toODataDateTimeLocal(getStartOfToday());

  const params = new URLSearchParams({
    '$select': 'Onderwerp,Soort,Datum,Aanvangstijd,Locatie,Nummer,Status,Kamer',
    '$filter': `Verwijderd eq false and Status eq 'Gepland' and Kamer eq 'Tweede Kamer' and Datum ge ${start}`,
    '$orderby': 'Datum asc',
    '$top': '200'
  });

  const url = `${TWEEDEKAMER_ODATA}?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Tweede Kamer OData fout: ${response.status}`);
  }

  const data = await response.json();
  const value = Array.isArray(data.value) ? data.value : [];

  const filtered = value
    .filter((item) => {
      const text = `${item.Onderwerp || ''} ${item.Soort || ''}`;
      return hasEnergyKeyword(text);
    })
    .map((item) => ({
      onderwerp: item.Onderwerp || '(zonder onderwerp)',
      soort: item.Soort || '',
      datum: item.Datum || null,
      aanvangstijd: item.Aanvangstijd || null,
      locatie: item.Locatie || '',
      nummer: item.Nummer || '',
      url: toTweedeKamerUrl(item.Nummer, item.Soort)
    }))
    .slice(0, 20);

  return filtered;
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;

  if (pathname === '/') {
    return sendFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
  }

  if (pathname === '/styles.css') {
    return sendFile(res, path.join(__dirname, 'styles.css'), 'text/css; charset=utf-8');
  }

  if (pathname === '/app.js') {
    return sendFile(res, path.join(__dirname, 'app.js'), 'application/javascript; charset=utf-8');
  }

  if (pathname === '/api/rijksoverheid') {
    const range = reqUrl.searchParams.get('range') === 'today' ? 'today' : 'week';
    try {
      const items = await getRijksoverheidPublicaties(range);
      return sendJson(res, 200, { range, items, updatedAt: new Date().toISOString() });
    } catch (error) {
      return sendJson(res, 502, {
        error: 'Kon publicaties van Rijksoverheid niet ophalen.',
        detail: error.message
      });
    }
  }

  if (pathname === '/api/debatten') {
    try {
      const items = await getTweedeKamerDebatten();
      return sendJson(res, 200, { items, updatedAt: new Date().toISOString() });
    } catch (error) {
      return sendJson(res, 502, {
        error: 'Kon debatten van Tweede Kamer niet ophalen.',
        detail: error.message
      });
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Pagina niet gevonden');
});

server.listen(PORT, HOST, () => {
  console.log(`Server draait op http://${HOST}:${PORT}`);
});
