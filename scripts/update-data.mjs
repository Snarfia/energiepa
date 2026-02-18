import fs from 'node:fs/promises';
import path from 'node:path';

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

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfLast7DaysUtc() {
  const start = startOfTodayUtc();
  start.setUTCDate(start.getUTCDate() - 6);
  return start;
}

function decodeXmlEntities(text = '') {
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
  const m = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'));
  return m ? decodeXmlEntities(m[1]) : '';
}

function parseRssItems(xml) {
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
  return blocks.map((block) => {
    const pubDateRaw = extractTagValue(block, 'pubDate');
    const parsed = pubDateRaw ? new Date(pubDateRaw) : null;
    return {
      title: extractTagValue(block, 'title'),
      link: extractTagValue(block, 'link'),
      description: extractTagValue(block, 'description').replace(/<[^>]+>/g, '').trim(),
      pubDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null
    };
  });
}

async function getPublicaties() {
  const res = await fetch(RIJKSOVERHEID_RSS, {
    headers: { 'User-Agent': 'energy-dashboard/1.0' }
  });
  if (!res.ok) throw new Error(`Rijksoverheid RSS fout ${res.status}`);
  const xml = await res.text();
  const cutoff = startOfLast7DaysUtc();

  const items = parseRssItems(xml)
    .filter((item) => item.pubDate && new Date(item.pubDate) >= cutoff)
    .sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1))
    .slice(0, 25);

  return {
    range: 'last7days',
    updatedAt: new Date().toISOString(),
    items
  };
}

function hasEnergyKeyword(text = '') {
  const lower = text.toLowerCase();
  return ENERGY_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function toTweedeKamerUrl(nummer, soort) {
  if (!nummer) return 'https://www.tweedekamer.nl/debat_en_vergadering';
  const kind = (soort || '').toLowerCase();

  if (kind.includes('plenair') || kind.includes('stemmingen') || kind.includes('vragenuur')) {
    return `https://www.tweedekamer.nl/debat_en_vergadering/plenaire_vergaderingen/details/activiteit?id=${encodeURIComponent(nummer)}`;
  }

  return `https://www.tweedekamer.nl/debat_en_vergadering/commissievergaderingen/details?id=${encodeURIComponent(nummer)}`;
}

function isoStartToday() {
  const d = startOfTodayUtc();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T00:00:00Z`;
}

async function getDebatten() {
  const params = new URLSearchParams({
    '$select': 'Onderwerp,Soort,Datum,Aanvangstijd,Locatie,Nummer,Status,Kamer',
    '$filter': `Verwijderd eq false and Status eq 'Gepland' and Kamer eq 'Tweede Kamer' and Datum ge ${isoStartToday()}`,
    '$orderby': 'Datum asc',
    '$top': '200'
  });

  const res = await fetch(`${TWEEDEKAMER_ODATA}?${params.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'energy-dashboard/1.0' }
  });
  if (!res.ok) throw new Error(`Tweede Kamer OData fout ${res.status}`);

  const data = await res.json();
  const value = Array.isArray(data.value) ? data.value : [];

  const items = value
    .filter((row) => hasEnergyKeyword(`${row.Onderwerp || ''} ${row.Soort || ''}`))
    .map((row) => ({
      onderwerp: row.Onderwerp || '(zonder onderwerp)',
      soort: row.Soort || '',
      datum: row.Datum || null,
      aanvangstijd: row.Aanvangstijd || null,
      locatie: row.Locatie || '',
      nummer: row.Nummer || '',
      url: toTweedeKamerUrl(row.Nummer || '', row.Soort || '')
    }))
    .slice(0, 20);

  return {
    updatedAt: new Date().toISOString(),
    items
  };
}

async function writeJson(filePath, data) {
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filePath, payload, 'utf8');
}

async function main() {
  const dataDir = path.resolve('data');
  await fs.mkdir(dataDir, { recursive: true });

  const [publicaties, debatten] = await Promise.all([getPublicaties(), getDebatten()]);

  await Promise.all([
    writeJson(path.join(dataDir, 'publicaties.json'), publicaties),
    writeJson(path.join(dataDir, 'debatten.json'), debatten)
  ]);

  console.log(`Publicaties: ${publicaties.items.length}`);
  console.log(`Debatten: ${debatten.items.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
