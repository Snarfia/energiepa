const SOURCE_LABELS = {
  rijksoverheid: 'Rijksoverheid',
  acm: 'ACM',
  eu: 'EU Commissie'
};

const state = {
  items: [],
  source: 'all',
  query: ''
};

const elements = {
  grid: document.getElementById('news-grid'),
  template: document.getElementById('news-card-template'),
  search: document.getElementById('search-input'),
  resultCount: document.getElementById('result-count'),
  articleCount: document.getElementById('article-count'),
  updatedAt: document.getElementById('updated-at'),
  headerStatus: document.getElementById('header-status'),
  sourceHealth: document.getElementById('source-health')
};

const dateFormatter = new Intl.DateTimeFormat('nl-NL', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
});

const dateTimeFormatter = new Intl.DateTimeFormat('nl-NL', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Datum onbekend' : dateFormatter.format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'onbekend' : dateTimeFormatter.format(date);
}

function normalize(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function filteredItems() {
  const query = normalize(state.query.trim());

  return state.items.filter((item) => {
    const matchesSource = state.source === 'all' || item.source === state.source;
    const haystack = normalize(`${item.title} ${item.description} ${item.sourceLabel}`);
    return matchesSource && (!query || haystack.includes(query));
  });
}

function renderNews() {
  const items = filteredItems();
  elements.grid.replaceChildren();
  elements.grid.setAttribute('aria-busy', 'false');

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('h3');
    title.textContent = 'Geen berichten gevonden';
    const copy = document.createElement('p');
    copy.textContent = 'Probeer een andere zoekterm of kies alle bronnen.';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Wis filters';
    reset.addEventListener('click', resetFilters);
    empty.append(title, copy, reset);
    elements.grid.appendChild(empty);
  } else {
    items.forEach((item, index) => {
      const fragment = elements.template.content.cloneNode(true);
      const card = fragment.querySelector('.news-card');
      const badge = fragment.querySelector('.source-badge');
      const time = fragment.querySelector('time');
      const title = fragment.querySelector('h3');
      const description = fragment.querySelector('.card-description');
      const link = fragment.querySelector('.card-link');

      card.dataset.source = item.source;
      card.classList.toggle('is-lead', index === 0);
      badge.textContent = item.sourceLabel || SOURCE_LABELS[item.source] || item.source;
      time.dateTime = item.publishedAt;
      time.textContent = formatDate(item.publishedAt);
      title.textContent = item.title;
      description.textContent = item.description || 'Bekijk het volledige bericht bij de bron.';
      link.href = item.url;
      link.setAttribute('aria-label', `${item.title} — lees bij ${badge.textContent}`);

      elements.grid.appendChild(fragment);
    });
  }

  const noun = items.length === 1 ? 'bericht' : 'berichten';
  elements.resultCount.textContent = `${items.length} ${noun} zichtbaar`;
}

function renderCounts() {
  const counts = state.items.reduce(
    (result, item) => {
      result.all += 1;
      result[item.source] = (result[item.source] || 0) + 1;
      return result;
    },
    { all: 0, rijksoverheid: 0, acm: 0, eu: 0 }
  );

  Object.entries(counts).forEach(([source, count]) => {
    const target = document.getElementById(`count-${source}`);
    if (target) target.textContent = count;
  });

  elements.articleCount.textContent = counts.all;
}

function renderSourceHealth(sources = {}) {
  elements.sourceHealth.replaceChildren();

  Object.entries(SOURCE_LABELS).forEach(([key, label]) => {
    const status = sources[key] || {};
    const item = document.createElement('div');
    item.className = 'health-item';

    const dot = document.createElement('span');
    dot.className = `health-dot health-${status.status || 'unknown'}`;
    dot.setAttribute('aria-hidden', 'true');

    const name = document.createElement('strong');
    name.textContent = label;

    const text = document.createElement('span');
    text.textContent =
      status.status === 'ok'
        ? 'actueel'
        : status.status === 'partial'
          ? 'deels ververst'
          : status.status === 'fallback'
            ? 'laatst bekende versie'
            : 'status onbekend';

    item.append(dot, name, text);
    elements.sourceHealth.appendChild(item);
  });
}

function resetFilters() {
  state.source = 'all';
  state.query = '';
  elements.search.value = '';
  document.querySelectorAll('.filter-button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.source === 'all');
  });
  renderNews();
}

function bindControls() {
  document.querySelectorAll('.filter-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.source = button.dataset.source;
      document.querySelectorAll('.filter-button').forEach((candidate) => {
        candidate.classList.toggle('is-active', candidate === button);
      });
      renderNews();
    });
  });

  elements.search.addEventListener('input', (event) => {
    state.query = event.target.value;
    renderNews();
  });

  document.addEventListener('keydown', (event) => {
    if (
      event.key === '/' &&
      document.activeElement !== elements.search &&
      !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
    ) {
      event.preventDefault();
      elements.search.focus();
    }

    if (event.key === 'Escape' && document.activeElement === elements.search) {
      elements.search.value = '';
      state.query = '';
      renderNews();
      elements.search.blur();
    }
  });
}

function showLoadError(error) {
  elements.grid.replaceChildren();
  elements.grid.setAttribute('aria-busy', 'false');

  const empty = document.createElement('div');
  empty.className = 'empty-state error-state';
  const title = document.createElement('h3');
  title.textContent = 'Het nieuws kon niet worden geladen';
  const copy = document.createElement('p');
  copy.textContent = 'Ververs de pagina over een moment opnieuw.';
  empty.append(title, copy);
  elements.grid.appendChild(empty);

  elements.resultCount.textContent = 'Tijdelijk niet beschikbaar';
  elements.headerStatus.textContent = 'Verversen mislukt';
  console.error(error);
}

async function loadNews() {
  try {
    const response = await fetch(`data/nieuws.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Nieuwsbestand gaf status ${response.status}`);

    const data = await response.json();
    state.items = Array.isArray(data.items) ? data.items : [];

    renderCounts();
    renderSourceHealth(data.sources);
    renderNews();

    const updated = formatDateTime(data.updatedAt);
    elements.updatedAt.textContent = `Bijgewerkt ${updated}`;
    elements.headerStatus.textContent = `Bijgewerkt ${updated}`;
  } catch (error) {
    showLoadError(error);
  }
}

bindControls();
loadNews();
