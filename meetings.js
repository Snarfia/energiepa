const MEETING_SOURCE_LABELS = {
  nl: 'Tweede Kamer',
  eu: 'Europese Commissie'
};

const meetingState = {
  items: [],
  source: 'all'
};

const meetingElements = {
  list: document.getElementById('meeting-list'),
  template: document.getElementById('meeting-card-template'),
  resultCount: document.getElementById('meeting-result-count'),
  totalCount: document.getElementById('meeting-count'),
  updatedAt: document.getElementById('meeting-updated-at'),
  headerStatus: document.getElementById('meeting-header-status'),
  sourceHealth: document.getElementById('meeting-source-health')
};

const dayFormatter = new Intl.DateTimeFormat('nl-NL', { day: '2-digit' });
const monthFormatter = new Intl.DateTimeFormat('nl-NL', { month: 'short' });
const meetingDateFormatter = new Intl.DateTimeFormat('nl-NL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
});
const meetingTimeFormatter = new Intl.DateTimeFormat('nl-NL', {
  hour: '2-digit',
  minute: '2-digit'
});
const updatedFormatter = new Intl.DateTimeFormat('nl-NL', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function meetingDetails(item) {
  const start = validDate(item.startAt);
  const end = validDate(item.endAt);
  if (!start) return item.location || 'Tijd nog niet bekend';

  let result = meetingDateFormatter.format(start);
  const hasTime = start.getHours() !== 0 || start.getMinutes() !== 0;
  if (hasTime) {
    result += ` · ${meetingTimeFormatter.format(start)}`;
    if (end && end.toDateString() === start.toDateString()) {
      result += `–${meetingTimeFormatter.format(end)}`;
    }
  }
  if (item.location) result += ` · ${item.location}`;
  return result;
}

function filteredMeetings() {
  return meetingState.items.filter(
    (item) => meetingState.source === 'all' || item.source === meetingState.source
  );
}

function renderMeetingCounts() {
  const counts = meetingState.items.reduce(
    (result, item) => {
      result.all += 1;
      result[item.source] = (result[item.source] || 0) + 1;
      return result;
    },
    { all: 0, nl: 0, eu: 0 }
  );

  Object.entries(counts).forEach(([source, count]) => {
    const target = document.getElementById(`meeting-count-${source}`);
    if (target) target.textContent = count;
  });
  meetingElements.totalCount.textContent = counts.all;
}

function renderMeetings() {
  const items = filteredMeetings();
  meetingElements.list.replaceChildren();
  meetingElements.list.setAttribute('aria-busy', 'false');

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('h3');
    title.textContent = 'Geen komende afspraken gevonden';
    const copy = document.createElement('p');
    copy.textContent = 'De officiële agenda bevat momenteel geen afspraken voor deze selectie.';
    empty.append(title, copy);
    meetingElements.list.appendChild(empty);
  } else {
    items.forEach((item) => {
      const fragment = meetingElements.template.content.cloneNode(true);
      const card = fragment.querySelector('.meeting-card');
      const day = fragment.querySelector('.date-day');
      const month = fragment.querySelector('.date-month');
      const badge = fragment.querySelector('.source-badge');
      const type = fragment.querySelector('.meeting-type');
      const title = fragment.querySelector('h3');
      const details = fragment.querySelector('.meeting-details');
      const description = fragment.querySelector('.meeting-description');
      const link = fragment.querySelector('.meeting-link');
      const start = validDate(item.startAt);

      card.dataset.meetingSource = item.source;
      day.textContent = start ? dayFormatter.format(start) : '—';
      month.textContent = start ? monthFormatter.format(start).replace('.', '') : '';
      badge.textContent = item.sourceLabel || MEETING_SOURCE_LABELS[item.source] || item.source;
      type.textContent = item.type || 'Vergadering';
      title.textContent = item.title;
      details.textContent = meetingDetails(item);
      description.textContent = item.description || '';
      description.hidden = !item.description;
      link.href = item.url;
      link.setAttribute('aria-label', `${item.title} — bekijk de officiële agenda`);

      meetingElements.list.appendChild(fragment);
    });
  }

  meetingElements.resultCount.textContent = `${items.length} ${
    items.length === 1 ? 'afspraak' : 'afspraken'
  } zichtbaar`;
}

function renderMeetingHealth(sources = {}) {
  meetingElements.sourceHealth.replaceChildren();

  Object.entries(MEETING_SOURCE_LABELS).forEach(([key, label]) => {
    const status = sources[key] || {};
    const item = document.createElement('div');
    item.className = 'health-item';
    const dot = document.createElement('span');
    dot.className = `health-dot health-${status.status || 'unknown'}`;
    dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong');
    name.textContent = label;
    const text = document.createElement('span');
    text.textContent = status.status === 'ok' ? 'actueel' : 'laatst bekende versie';
    item.append(dot, name, text);
    meetingElements.sourceHealth.appendChild(item);
  });
}

function bindMeetingControls() {
  document.querySelectorAll('[data-meeting-source]').forEach((button) => {
    button.addEventListener('click', () => {
      meetingState.source = button.dataset.meetingSource;
      document.querySelectorAll('[data-meeting-source]').forEach((candidate) => {
        candidate.classList.toggle('is-active', candidate === button);
      });
      renderMeetings();
    });
  });
}

function showMeetingError(error) {
  meetingElements.list.replaceChildren();
  meetingElements.list.setAttribute('aria-busy', 'false');
  const empty = document.createElement('div');
  empty.className = 'empty-state error-state';
  const title = document.createElement('h3');
  title.textContent = 'De agenda kon niet worden geladen';
  const copy = document.createElement('p');
  copy.textContent = 'Ververs de pagina over een moment opnieuw.';
  empty.append(title, copy);
  meetingElements.list.appendChild(empty);
  meetingElements.resultCount.textContent = 'Tijdelijk niet beschikbaar';
  meetingElements.headerStatus.textContent = 'Verversen mislukt';
  console.error(error);
}

async function loadMeetings() {
  try {
    const response = await fetch(`data/vergaderingen.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Agendabestand gaf status ${response.status}`);

    const data = await response.json();
    meetingState.items = Array.isArray(data.items) ? data.items : [];
    renderMeetingCounts();
    renderMeetingHealth(data.sources);
    renderMeetings();

    const updated = validDate(data.updatedAt);
    const label = updated ? updatedFormatter.format(updated) : 'onbekend';
    meetingElements.updatedAt.textContent = `Bijgewerkt ${label}`;
    meetingElements.headerStatus.textContent = `Bijgewerkt ${label}`;
  } catch (error) {
    showMeetingError(error);
  }
}

bindMeetingControls();
loadMeetings();
