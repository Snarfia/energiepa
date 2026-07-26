import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUTPUT_PATH = path.resolve('data', 'vergaderingen.json');
const MAX_ITEMS_PER_SOURCE = 30;
const TWEEDE_KAMER_API =
  'https://gegevensmagazijn.tweedekamer.nl/OData/v4/2.0/Activiteit';
const EU_EVENTS_FEED = 'https://energy.ec.europa.eu/node/4/rss_en';

const SOURCE_LABELS = {
  nl: 'Tweede Kamer',
  eu: 'Europese Commissie'
};

const ENERGY_PATTERN =
  /\b(energie\w*|klimaat\w*|elektri\w*|gas|gasmarkt|aardgas\w*|waterstof\w*|warmte\w*|kernenergie|mijnbouw|netcongestie|energieraad|windenergie|zonne-?energie|emissie\w*|duurza\w*|circulaire economie|kolen|brandstof\w*)\b|klimaat en groene groei/iu;

const ALLOWED_ACTIVITY_TYPES = [
  'Commissiedebat',
  'Plenair debat',
  'Procedurevergadering',
  'Technische briefing',
  'Rondetafelgesprek',
  'Wetgevingsoverleg',
  'Notaoverleg',
  'Werkbezoek',
  'Gesprek',
  'Petitie',
  'Hoorzitting',
  'Vergadering'
];

function todayInAmsterdam() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function itemId(source, value) {
  return `${source}-${createHash('sha1').update(value).digest('hex').slice(0, 12)}`;
}

function decodeEntities(value = '') {
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
  return match ? decodeEntities(match[1]) : '';
}

function plainText(value = '') {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shorten(value, maximum = 220) {
  if (!value || value.length <= maximum) return value;
  return `${value.slice(0, maximum - 1).replace(/\s+\S*$/, '')}…`;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, application/rss+xml, application/xml;q=0.9, text/html;q=0.8',
      'User-Agent': 'EnergiePA-beleidsradar/3.0 (+https://github.com/Snarfia/energiepa)'
    },
    signal: AbortSignal.timeout(25_000)
  });

  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

function isAllowedActivity(item) {
  const text = `${item.Onderwerp || ''} ${item.Voortouwnaam || ''}`;
  const allowedType = ALLOWED_ACTIVITY_TYPES.some((type) => item.Soort?.startsWith(type));
  const current = !/(geannuleerd|verplaatst|vervallen|uitgesteld)/i.test(item.Onderwerp || '');
  return allowedType && current && ENERGY_PATTERN.test(text);
}

function tweedeKamerUrl(item) {
  const plenary = /^(Plenair debat|Stemmingen|Hamerstukken|Regeling van werkzaamheden|Vragenuur)/.test(
    item.Soort || ''
  );
  return plenary
    ? `https://www.tweedekamer.nl/debat_en_vergadering/plenaire_vergaderingen/details/activiteit?id=${encodeURIComponent(item.Nummer)}`
    : `https://www.tweedekamer.nl/debat_en_vergadering/commissievergaderingen/details?id=${encodeURIComponent(item.Nummer)}`;
}

async function fetchDutchMeetings() {
  const url = new URL(TWEEDE_KAMER_API);
  url.searchParams.set(
    '$filter',
    `Datum ge ${todayInAmsterdam()} and Verwijderd eq false and Besloten eq false and Status eq 'Gepland'`
  );
  url.searchParams.set(
    '$select',
    'Id,Nummer,Soort,Onderwerp,Datum,Aanvangstijd,Eindtijd,Locatie,Status,Voortouwnaam,Voortouwafkorting,Besloten'
  );
  url.searchParams.set('$orderby', 'Datum asc,Aanvangstijd asc');
  url.searchParams.set('$top', '250');

  const data = JSON.parse(await fetchText(url));
  if (!Array.isArray(data.value)) throw new Error('Tweede Kamer gaf geen activiteitenlijst.');

  return data.value
    .filter(isAllowedActivity)
    .map((item) => ({
      id: itemId('nl', item.Id || item.Nummer),
      source: 'nl',
      sourceLabel: SOURCE_LABELS.nl,
      title: plainText(item.Onderwerp),
      startAt: item.Aanvangstijd || item.Datum,
      endAt: item.Eindtijd || item.Aanvangstijd || item.Datum,
      location: plainText(item.Locatie || 'Tweede Kamer, Den Haag'),
      type: plainText(item.Soort || 'Vergadering'),
      description: plainText(item.Voortouwnaam || ''),
      url: tweedeKamerUrl(item),
      language: 'nl'
    }))
    .filter((item) => item.title && item.startAt && item.url);
}

function parseRssItems(xml) {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  return blocks
    .map((block) => ({
      title: plainText(extractTag(block, 'title')),
      url: extractTag(block, 'link'),
      description: shorten(plainText(extractTag(block, 'description')))
    }))
    .filter((item) => item.title && item.url);
}

function findEventSchema(value) {
  if (!value || typeof value !== 'object') return null;
  const type = value['@type'];
  if (type === 'Event' || (Array.isArray(type) && type.includes('Event'))) return value;

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findEventSchema(child);
      if (found) return found;
    }
  }
  return null;
}

function parseEventSchema(html) {
  const scripts = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )
  ];

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(decodeEntities(script[1]));
      const event = findEventSchema(parsed);
      if (event) return event;
    } catch {
      // Een pagina kan meerdere JSON-LD-blokken bevatten; probeer het volgende blok.
    }
  }
  return null;
}

function locationLabel(location) {
  if (!location) return '';
  if (typeof location === 'string') return plainText(location);
  if (Array.isArray(location)) return location.map(locationLabel).filter(Boolean).join(' · ');

  const address = location.address;
  const parts = [
    location.name,
    typeof address === 'string' ? address : address?.addressLocality,
    typeof address === 'object' ? address.addressCountry : ''
  ]
    .map((part) => plainText(part || '').replace(/[,\s]+$/, ''))
    .filter(Boolean);
  return [...new Set(parts)].join(', ');
}

function dateFromEventUrl(url) {
  const match = url.match(/-(\d{4}-\d{2}-\d{2})_en(?:$|[?#])/);
  return match ? `${match[1]}T09:00:00+02:00` : null;
}

async function enrichEuropeanEvent(item) {
  try {
    const schema = parseEventSchema(await fetchText(item.url));
    const startAt = schema?.startDate || dateFromEventUrl(item.url);
    if (!startAt) return null;

    return {
      id: itemId('eu', item.url),
      source: 'eu',
      sourceLabel: SOURCE_LABELS.eu,
      title: plainText(schema?.name || item.title),
      startAt,
      endAt: schema?.endDate || startAt,
      location: locationLabel(schema?.location) || 'Europa / online',
      type: plainText(schema?.eventAttendanceMode || 'Europees energie-evenement')
        .replace(/^https?:\/\/schema\.org\//, '')
        .replace(/EventAttendanceMode$/, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2'),
      description: item.description,
      url: item.url,
      language: 'en'
    };
  } catch {
    const startAt = dateFromEventUrl(item.url);
    if (!startAt) return null;
    return {
      id: itemId('eu', item.url),
      source: 'eu',
      sourceLabel: SOURCE_LABELS.eu,
      title: item.title,
      startAt,
      endAt: startAt,
      location: 'Europa / online',
      type: 'Europees energie-evenement',
      description: item.description,
      url: item.url,
      language: 'en'
    };
  }
}

async function fetchEuropeanMeetings() {
  const rssItems = parseRssItems(await fetchText(EU_EVENTS_FEED));
  if (!rssItems.length) throw new Error('Europese Commissie gaf geen evenementen.');

  const results = await Promise.all(rssItems.map(enrichEuropeanEvent));
  const now = Date.now();
  return results.filter((item) => {
    if (!item) return false;
    const end = new Date(item.endAt || item.startAt).getTime();
    return !Number.isNaN(end) && end >= now;
  });
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
  items.forEach((item) => byUrl.set(item.url, item));
  return [...byUrl.values()];
}

async function main() {
  const previous = await readPreviousData();
  const tasks = {
    nl: fetchDutchMeetings(),
    eu: fetchEuropeanMeetings()
  };
  const entries = Object.entries(tasks);
  const settled = await Promise.allSettled(entries.map(([, task]) => task));
  const items = [];
  const sources = {};

  entries.forEach(([source], index) => {
    const result = settled[index];
    const liveItems = result.status === 'fulfilled' ? result.value : [];
    const sourceItems = (liveItems.length
      ? liveItems
      : (previous.items || []).filter((item) => item.source === source)
    )
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .slice(0, MAX_ITEMS_PER_SOURCE);

    const status = liveItems.length ? 'ok' : 'fallback';
    items.push(...sourceItems);
    sources[source] = {
      label: SOURCE_LABELS[source],
      status,
      count: sourceItems.length,
      updatedAt: new Date().toISOString(),
      error: result.status === 'rejected' ? result.reason?.message : null
    };
  });

  if (!items.length) throw new Error('Geen vergaderingen opgehaald en geen eerdere gegevens beschikbaar.');

  const payload = {
    updatedAt: new Date().toISOString(),
    items: deduplicate(items).sort((a, b) => a.startAt.localeCompare(b.startAt)),
    sources
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  Object.entries(sources).forEach(([source, info]) => {
    console.log(`${SOURCE_LABELS[source]}: ${info.count} afspraken (${info.status})`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
