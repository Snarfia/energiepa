import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUTPUT_PATH = path.resolve('data', 'nieuws.json');
const MAX_ITEMS_PER_SOURCE = 20;
const ACM_RELEVANCE_PATTERN =
  /\b(energie|elektric|gas|warmte|remit|afleverset|netbeheer|netcongest|nettarief|distributiesysteem|gesloten systeem|hv station|brandstof|benzine|diesel|laad|zonne|wind|waterstof|emissie|klimaat|duurzaam|energietransitie|salder|stroom|energielever)/i;

const SOURCE_LABELS = {
  rijksoverheid: 'Rijksoverheid',
  acm: 'ACM',
  eu: 'EU Commissie'
};

function rijksoverheidFeed(topic) {
  const query = {
    filters: [
      {
        field: 'content_type',
        values: ['pro:newsDocument'],
        type: 'all'
      },
      {
        field: 'topic',
        values: [topic],
        type: 'all'
      }
    ],
    resultSearchTerm: '',
    pageTitle: 'Nieuws'
  };

  return `https://www.rijksoverheid.nl/api/rss?query=${encodeURIComponent(JSON.stringify(query))}`;
}

const FEEDS = [
  {
    source: 'rijksoverheid',
    name: 'Rijksoverheid · duurzame energie',
    url: rijksoverheidFeed('Duurzame energie')
  },
  {
    source: 'rijksoverheid',
    name: 'Rijksoverheid · klimaatverandering',
    url: rijksoverheidFeed('Klimaatverandering')
  },
  {
    source: 'acm',
    name: 'ACM · energie',
    url: 'https://www.acm.nl/nl/nieuws/rss/publicaties?field_subjects[0]=6320&publication_type[0]=1'
  },
  {
    source: 'eu',
    name: 'Europese Commissie · energie',
    url: 'https://energy.ec.europa.eu/node/2/rss_en'
  },
  {
    source: 'eu',
    name: 'Europese Commissie · klimaat',
    url: 'https://climate.ec.europa.eu/node/2/rss_en'
  }
];

function decodeXmlEntities(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .trim();
}

function extractTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'i'));
  return match ? decodeXmlEntities(match[1]) : '';
}

function plainText(value = '') {
  const text = decodeXmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!/[ÃÂâ]/.test(text)) return text;

  const repaired = Buffer.from(text, 'latin1').toString('utf8');
  const corruptionScore = (candidate) => (candidate.match(/[ÃÂâ�]/g) || []).length;
  return corruptionScore(repaired) < corruptionScore(text) ? repaired : text;
}

function shorten(value, maximum = 260) {
  if (value.length <= maximum) return value;
  const shortened = value.slice(0, maximum - 1).replace(/\s+\S*$/, '');
  return `${shortened}…`;
}

function itemId(source, url) {
  return `${source}-${createHash('sha1').update(url).digest('hex').slice(0, 12)}`;
}

function parseRss(xml, feed) {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];

  return blocks
    .map((block) => {
      const title = plainText(extractTag(block, 'title'));
      const url = extractTag(block, 'link');
      const description = shorten(plainText(extractTag(block, 'description')));
      const rawDate = extractTag(block, 'pubDate') || extractTag(block, 'dc:date');
      const date = rawDate ? new Date(rawDate) : null;

      if (!title || !url || !date || Number.isNaN(date.getTime())) return null;

      return {
        id: itemId(feed.source, url),
        source: feed.source,
        sourceLabel: SOURCE_LABELS[feed.source],
        feed: feed.name,
        title,
        description,
        url,
        publishedAt: date.toISOString(),
        language: feed.source === 'eu' ? 'en' : 'nl'
      };
    })
    .filter(Boolean);
}

async function fetchFeed(feed) {
  const response = await fetch(feed.url, {
    headers: {
      Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
      'User-Agent': 'EnergiePA-beleidsradar/2.0 (+https://github.com/Snarfia/energiepa)'
    },
    signal: AbortSignal.timeout(25_000)
  });

  if (!response.ok) {
    throw new Error(`${feed.name}: HTTP ${response.status}`);
  }

  const xml = await response.text();
  const items = parseRss(xml, feed);
  if (!items.length) throw new Error(`${feed.name}: geen geldige berichten`);
  return items;
}

async function readPreviousData() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
  } catch {
    return { items: [], sources: {} };
  }
}

function deduplicate(items) {
  const byUrl = new Map();
  items.forEach((item) => {
    const existing = byUrl.get(item.url);
    if (!existing || item.publishedAt > existing.publishedAt) byUrl.set(item.url, item);
  });
  return [...byUrl.values()];
}

async function main() {
  const previous = await readPreviousData();
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const collected = [];
  const sources = {};

  Object.keys(SOURCE_LABELS).forEach((source) => {
    const feedIndexes = FEEDS.map((feed, index) => ({ feed, index })).filter(
      ({ feed }) => feed.source === source
    );
    const successful = feedIndexes.filter(({ index }) => results[index].status === 'fulfilled');
    const failed = feedIndexes.filter(({ index }) => results[index].status === 'rejected');

    let sourceItems = successful.flatMap(({ index }) => results[index].value);
    let status = failed.length ? 'partial' : 'ok';

    if (!successful.length) {
      sourceItems = (previous.items || []).filter((item) => item.source === source);
      status = 'fallback';
    }

    if (source === 'acm') {
      sourceItems = sourceItems.filter((item) =>
        ACM_RELEVANCE_PATTERN.test(`${item.title} ${item.description}`)
      );
    }

    sourceItems = deduplicate(sourceItems)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, MAX_ITEMS_PER_SOURCE);

    collected.push(...sourceItems);
    sources[source] = {
      label: SOURCE_LABELS[source],
      status,
      count: sourceItems.length,
      updatedAt: new Date().toISOString(),
      failedFeeds: failed.map(({ feed }) => feed.name)
    };
  });

  if (!collected.length) {
    throw new Error('Geen nieuws opgehaald en geen eerdere gegevens beschikbaar.');
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    items: deduplicate(collected).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    sources
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  Object.entries(sources).forEach(([source, info]) => {
    console.log(`${SOURCE_LABELS[source]}: ${info.count} berichten (${info.status})`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
