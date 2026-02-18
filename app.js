const pubList = document.getElementById('pub-list');
const debateList = document.getElementById('debate-list');
const pubStatus = document.getElementById('pub-status');
const debateStatus = document.getElementById('debate-status');

function formatDate(iso) {
  if (!iso) return 'Onbekende datum';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Onbekende datum';
  return date.toLocaleDateString('nl-NL', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatTime(value) {
  if (!value) return '';
  const raw = String(value).slice(0, 5);
  return raw ? `${raw} uur` : '';
}

function clearList(listEl) {
  while (listEl.firstChild) {
    listEl.removeChild(listEl.firstChild);
  }
}

function appendEmpty(listEl, text) {
  const li = document.createElement('li');
  li.className = 'item';
  li.textContent = text;
  listEl.appendChild(li);
}

function renderPublicaties(items) {
  clearList(pubList);

  if (!items.length) {
    appendEmpty(pubList, 'Geen publicaties gevonden voor deze periode.');
    return;
  }

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'item';

    const title = document.createElement('a');
    title.href = item.link;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    title.textContent = item.title || 'Zonder titel';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = formatDate(item.pubDate);

    li.appendChild(title);
    li.appendChild(meta);
    pubList.appendChild(li);
  });
}

function renderDebatten(items) {
  clearList(debateList);

  if (!items.length) {
    appendEmpty(debateList, 'Geen aankomende energie/klimaatdebatten gevonden.');
    return;
  }

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'item';

    const title = document.createElement('a');
    title.href = item.url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    title.textContent = item.onderwerp || '(zonder onderwerp)';

    const details = [formatDate(item.datum), formatTime(item.aanvangstijd), item.soort, item.locatie]
      .filter(Boolean)
      .join(' | ');

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = details;

    li.appendChild(title);
    li.appendChild(meta);
    debateList.appendChild(li);
  });
}

async function loadPublicaties() {
  pubStatus.textContent = 'Publicaties laden...';
  try {
    const response = await fetch('data/publicaties.json', { cache: 'no-store' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Onbekende fout');
    }

    renderPublicaties(data.items || []);
    const suffix = data.updatedAt ? ` Laatst ververst: ${formatDate(data.updatedAt)}.` : '';
    pubStatus.textContent = `${(data.items || []).length} publicaties gevonden.${suffix}`;
  } catch (error) {
    clearList(pubList);
    appendEmpty(pubList, 'Er ging iets mis bij het ophalen van publicaties.');
    pubStatus.textContent = `Fout: ${error.message}`;
  }
}

async function loadDebatten() {
  debateStatus.textContent = 'Debatten laden...';
  try {
    const response = await fetch('data/debatten.json', { cache: 'no-store' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Onbekende fout');
    }

    renderDebatten(data.items || []);
    const suffix = data.updatedAt ? ` Laatst ververst: ${formatDate(data.updatedAt)}.` : '';
    debateStatus.textContent = `${(data.items || []).length} aankomende debatten gevonden.${suffix}`;
  } catch (error) {
    clearList(debateList);
    appendEmpty(debateList, 'Er ging iets mis bij het ophalen van debatten.');
    debateStatus.textContent = `Fout: ${error.message}`;
  }
}

loadPublicaties();
loadDebatten();
