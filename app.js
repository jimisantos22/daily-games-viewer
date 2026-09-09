const API_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';

async function apiRequest(action, params = {}) {
  if (!API_URL || API_URL.indexOf('PASTE_YOUR_') === 0) {
    throw new Error('Please set API_URL in app.js to your Apps Script Web App URL.');
  }

  const query = new URLSearchParams({
    api: '1',
    action: action,
    ...params
  });

  const response = await fetch(API_URL + '?' + query.toString(), {
    method: 'GET',
    cache: 'no-store',
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error('API request failed: HTTP ' + response.status);
  }

  const data = await response.json();

  if (data && data.ok === false) {
    throw new Error(data.error || 'API request failed.');
  }

  return data;
}

let appData = { weeks: [] };
let currentWeek = '';
let currentDate = '';
let currentCluster = '';
let currentGame = '';
const AUTO_REFRESH_INTERVAL = 1000;
let autoRefreshTimer = null;
let refreshInProgress = false;

// Keep already-loaded game information in the browser so switching
// Game A -> Game B -> Game A is instant. The server is still refreshed
// in the background so the cached copy can be updated.
const gameDetailsCache = Object.create(null);
const viewerListCache = Object.create(null);
let gameDetailsRequestId = 0;
let lastRenderedGameListSignature = '';
let lastRenderedGameListCluster = '';


document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('weekSelect').addEventListener('change', handleWeekChange);
  document.getElementById('dateSelect').addEventListener('change', handleDateChange);
  document.getElementById('clusterSelect').addEventListener('change', handleClusterChange);
  document.getElementById('gameSelect').addEventListener('change', handleGameChange);
  loadAppData();
  startAutoRefresh();
});

function startAutoRefresh() {

  if (autoRefreshTimer) {

    clearInterval(
      autoRefreshTimer
    );

  }

  autoRefreshTimer =
    setInterval(
      autoRefresh,
      AUTO_REFRESH_INTERVAL
    );

}


function autoRefresh() {

  if (
    refreshInProgress ||
    !currentWeek ||
    !currentDate ||
    !currentCluster
  ) {

    return;

  }

  refreshInProgress = true;

  const week = currentWeek;
  const date = currentDate;
  const cluster = currentCluster;
  const game = currentGame;
  const requestId = gameDetailsRequestId;

  /*
   * ONE server call only.
   *
   * getViewerData() returns both:
   *   - the current game list / brand statuses
   *   - the currently selected game's details
   *
   * This avoids two Apps Script calls every refresh cycle.
   */
  apiRequest('viewerData', { week: week, date: date, cluster: cluster, game: game }).then(function(data) {

      if (
        currentWeek !== week ||
        currentDate !== date ||
        currentCluster !== cluster ||
        currentGame !== game
      ) {

        refreshInProgress = false;
        return;

      }

      if (
        data &&
        Array.isArray(data.games)
      ) {

        renderGameDisplayList(
          data.games,
          cluster
        );

      }

      /*
       * Only update the details panel if the user has not
       * selected another game while this request was running.
       */
      if (
        game &&
        data &&
        data.gameDetails &&
        requestId === gameDetailsRequestId &&
        currentGame === game
      ) {

        const cacheKey = makeGameDetailsCacheKey(
          week,
          date,
          cluster,
          game
        );

        gameDetailsCache[cacheKey] =
          data.gameDetails;

        renderGameDetails(
          data.gameDetails
        );

        renderExternalWeeklyGameData(
          data.external ||
          data.gameDetails.external || {
            found: false,
            gameId: '',
            details: []
          }
        );

      }

      refreshInProgress = false;

    })
    .withFailureHandler(function(error) {

      console.error(
        'Automatic refresh error:',
        error
      );

      refreshInProgress = false;

    })
    .getViewerData(
      week,
      date,
      cluster,
      game
    );

}

function loadAppData() {
  setStatus('Loading...', 'loading');
  apiRequest('initialAppData').then(function(data) {
    appData = data || { weeks: [], datesByWeek: {}, clusters: [] };
    populateWeeks();
    loadClusters();
    setStatus('', '');
  }).catch(function(error) {
    console.error('initialAppData error:', error);
    setStatus(getErrorMessage(error), 'error');
  });
}

function populateWeeks() {
  const select = document.getElementById('weekSelect');
  const weeks = appData.weeks || [];
  select.innerHTML = '<option value="">Select Week</option>';
  weeks.forEach(function(week) {
    const option = document.createElement('option');
    option.value = week;
    option.textContent = 'Week ' + week;
    select.appendChild(option);
  });
  if (weeks.length) {
    currentWeek = String(weeks[0]);
    select.value = currentWeek;
    loadDates(currentWeek);
  }
}

function loadClusters(selectedCluster) {
  const clusters = appData.clusters || [];
  const select = document.getElementById('clusterSelect');
  const previous = selectedCluster || currentCluster || '';
  select.innerHTML = '<option value="">Select Cluster</option>';
  clusters.forEach(function(cluster) {
    const option = document.createElement('option');
    option.value = cluster;
    option.textContent = cluster;
    select.appendChild(option);
  });
  if (previous && clusters.indexOf(previous) !== -1) {
    select.value = previous;
    currentCluster = previous;
  } else {
    select.value = '';
  }
  select.disabled = !currentDate;
}

function handleWeekChange() {
  currentWeek = document.getElementById('weekSelect').value;
  currentDate = '';
  currentCluster = '';
  currentGame = '';
  resetDateSelect();
  resetClusterSelect();
  resetGameSelect();
  hideDetails();
  if (currentWeek) loadDates(currentWeek);
}

function handleDateChange() {
  currentDate = document.getElementById('dateSelect').value;
  currentGame = '';
  resetGameSelect();
  hideDetails();
  if (!currentDate) {
    resetClusterSelect();
    return;
  }
  enableClusterSelect();
  if (currentCluster) loadGameDisplayList();
}

function handleClusterChange() {
  currentCluster = document.getElementById('clusterSelect').value;
  currentGame = '';
  resetGameSelect();
  hideDetails();
  if (currentWeek && currentDate && currentCluster) loadGameDisplayList();
}

function handleGameChange() {
  currentGame = document.getElementById('gameSelect').value;
  hideDetails();
  if (currentGame) loadGameDetails();
}

function loadDates(week) {
  resetDateSelect();
  resetClusterSelect();
  resetGameSelect();
  hideDetails();
  if (!week) return;
  setStatus('Loading dates...', 'loading');
  const dates = (appData.datesByWeek || {})[String(week)] || [];
  if (currentWeek !== String(week)) return;
  const select = document.getElementById('dateSelect');
  select.innerHTML = '<option value="">Select Date</option>';
  dates.forEach(function(date) {
    const option = document.createElement('option');
    option.value = date;
    option.textContent = formatDateForDisplay(date);
    select.appendChild(option);
  });
  select.disabled = !dates.length;
  if (dates.length) {
    currentDate = dates[0];
    select.value = currentDate;
    enableClusterSelect();
  }
  setStatus('', '');
}

function enableClusterSelect() {
  document.getElementById('clusterSelect').disabled = !currentDate;
}

function resetDateSelect() {
  const select = document.getElementById('dateSelect');
  select.innerHTML = '<option value="">Select Date</option>';
  select.value = '';
  select.disabled = true;
}

function resetClusterSelect() {
  const select = document.getElementById('clusterSelect');
  if (!select.options.length) select.innerHTML = '<option value="">Select Cluster</option>';
  select.value = '';
  select.disabled = true;
  currentCluster = '';
}

function resetGameSelect() {
  lastRenderedGameListSignature = '';
  lastRenderedGameListCluster = '';
  const select = document.getElementById('gameSelect');
  select.innerHTML = '<option value="">Select Game</option>';
  select.value = '';
  select.disabled = true;
  const list = document.getElementById('gameDisplayList');
  list.innerHTML = '';
  document.getElementById('gameDisplaySection').style.display = 'none';
}

function loadGameDisplayList() {
  if (!currentWeek || !currentDate || !currentCluster) return;

  const week = currentWeek;
  const date = currentDate;
  const cluster = currentCluster;
  const cacheKey = makeViewerListCacheKey(week, date, cluster);
  const cachedGames = viewerListCache[cacheKey];

  if (cachedGames) {
    renderGameDisplayList(cachedGames, cluster);
    setStatus('', '');
  } else {
    setStatus('Loading games...', 'loading');
  }

  apiRequest('viewerData', { week: week, date: date, cluster: cluster, game: game }).then(function(data) {
      if (
        currentWeek !== week ||
        currentDate !== date ||
        currentCluster !== cluster
      ) return;

      const games = (data && data.games) || [];
      viewerListCache[cacheKey] = games;
      renderGameDisplayList(games, cluster);
      setStatus('', '');
    }).catch(function(error) {
      console.error('viewerData error:', error);
      if (!cachedGames) {
        setStatus(getErrorMessage(error), 'error');
      }
    });
}


function getGameStatusColor(cluster, datasetStatus) {
  const status = String(datasetStatus || '').toLowerCase().trim();
  if (!status) return '#111827';
  const keywords = {
    Red: ['red', 'ibet', 'arctic'],
    Green: ['green', 'qbet', 'manga', '30bet', 'gqbet', '55bet'],
    Orange: ['orange', 'bvbet', '7abet', 'howzit'],
    Blue: ['blue', 'slotexpress'],
    Yellow: ['yellow', 'spineazy']
  };
  const colors = { Red: '#dc2626', Green: '#16a34a', Orange: '#ea580c', Blue: '#2563eb', Yellow: '#ca8a04' };
  const list = keywords[cluster] || [];
  const matched = list.some(function(keyword) {
    return new RegExp('(^|[^a-z0-9])' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i').test(status);
  });
  return matched ? colors[cluster] : '#111827';
}

function renderGameDisplayList(games, cluster) {
  const gameArray = games || [];
  const signature = JSON.stringify(gameArray);

  // Avoid rebuilding the entire game list DOM when the 3-second refresh
  // returns exactly the same data. This keeps the existing UI unchanged
  // while removing a large amount of unnecessary browser work.
  if (signature === lastRenderedGameListSignature && cluster === lastRenderedGameListCluster) {
    return;
  }

  lastRenderedGameListSignature = signature;
  lastRenderedGameListCluster = cluster;

  const select = document.getElementById('gameSelect');
  const list = document.getElementById('gameDisplayList');
  const section = document.getElementById('gameDisplaySection');
  const previousGame = currentGame;
  select.innerHTML = '<option value="">Select Game</option>';
  list.innerHTML = '';

  gameArray.forEach(function(item) {
    if (!item || !item.game) return;
    const option = document.createElement('option');
    option.value = item.game;
    option.textContent = item.game;
    select.appendChild(option);

    const row = document.createElement('div');
    row.className = 'game-display-row';

    const gameName = document.createElement('div');
    gameName.className = 'game-display-game';
    gameName.textContent = item.game;
    gameName.style.color = getGameStatusColor(cluster, item.datasetStatus);
    if (item.externalMatch === false) gameName.classList.add('game-not-matched');

    const position = document.createElement('div');
    position.className = 'game-display-position';
    position.textContent = displayDash(item.position);

    const working = document.createElement('div');
    working.className = 'game-display-working';
    if (cluster === 'Red' || cluster === 'Green' || cluster === 'Orange') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!item.gameWorking;
      checkbox.disabled = true;
      checkbox.setAttribute('aria-label', 'Game Working');
      working.appendChild(checkbox);
    } else {
      working.textContent = '—';
    }

    row.appendChild(gameName);
    row.appendChild(position);
    row.appendChild(working);
    row.addEventListener('click', function() {
      select.value = item.game;
      currentGame = item.game;
      loadGameDetails();
    });
    list.appendChild(row);
  });

  select.disabled = gameArray.length === 0;
  if (previousGame && gameArray.some(function(item) { return item && sameGame(item.game, previousGame); })) select.value = previousGame;
  section.style.display = gameArray.length ? 'block' : 'none';
}

function makeGameDetailsCacheKey(week, date, cluster, game) {
  return [week, date, cluster, String(game || '').trim().toLowerCase()]
    .join('\u0001');
}

function makeViewerListCacheKey(week, date, cluster) {
  return [week, date, cluster].join('\u0001');
}

function loadGameDetails() {
  if (!currentWeek || !currentDate || !currentCluster || !currentGame) return;

  const week = currentWeek;
  const date = currentDate;
  const cluster = currentCluster;
  const game = currentGame;
  const cacheKey = makeGameDetailsCacheKey(week, date, cluster, game);
  const requestId = ++gameDetailsRequestId;
  const cachedDetails = gameDetailsCache[cacheKey];

  /*
   * Show an already-loaded game immediately, but DO NOT return here.
   * The server is still queried in the background so edits made in the
   * source sheets are reflected the next time the game is selected.
   */
  if (cachedDetails) {
    renderGameDetails(cachedDetails);
    renderExternalWeeklyGameData(cachedDetails.external || {
      found: false,
      gameId: '',
      details: []
    });
    setStatus('', '');
  } else {
    setStatus('Loading game information...', 'loading');
  }

  apiRequest('viewerData', { week: week, date: date, cluster: cluster, game: game }).then(function(data) {
      if (!data || !data.gameDetails) {
        if (requestId === gameDetailsRequestId) {
          setStatus('No game information found.', 'error');
        }
        return;
      }

      gameDetailsCache[cacheKey] = data.gameDetails;

      if (
        currentWeek !== week ||
        currentDate !== date ||
        currentCluster !== cluster ||
        currentGame !== game ||
        requestId !== gameDetailsRequestId
      ) {
        return;
      }

      renderGameDetails(data.gameDetails);
      renderExternalWeeklyGameData(data.external || data.gameDetails.external || {
        found: false,
        gameId: '',
        details: []
      });
      setStatus('', '');
    }).catch(function(error) {
      console.error('viewerData error:', error);
      if (requestId === gameDetailsRequestId) {
        setStatus(getErrorMessage(error), 'error');
      }
    });
}


function renderGameDetails(data) {
  window.currentGameDetails = data || null;
  document.getElementById('selectedGame').textContent = displayDash(data.game);
  document.getElementById('selectedStudio').textContent = displayDash(data.studio);
  document.getElementById('selectedType').textContent = displayDash(data.type);
  document.getElementById('selectedGameId').textContent = displayDash(data.gameId);
  document.getElementById('selectedReleaseNotes').textContent = displayDash(data.releaseNotes);
  document.getElementById('selectedSlug').textContent = displayDash(data.slug);
  const tagElement = document.getElementById('selectedTag');
  const tag = String(data.tag || '').trim();
  tagElement.className = 'game-meta-value';
  if (tag.toLowerCase() === 'early access') {
    tagElement.className += ' tag-early-access';
    tagElement.textContent = 'Early Access';
  } else if (tag.toLowerCase() === 'global release') {
    tagElement.className += ' tag-global-release';
    tagElement.textContent = 'Global Release';
  } else tagElement.textContent = displayDash(tag);

  const brandsElement = document.getElementById('availableBrands');
  brandsElement.innerHTML = '';
  if (data.availableOn && data.availableOn.length) {
    data.availableOn.forEach(function(brand) {
      const span = document.createElement('span');
      span.className = 'brand-badge';
      span.textContent = brand;
      brandsElement.appendChild(span);
    });
  } else brandsElement.textContent = '-';
  renderFeatures(data);
  document.getElementById('details').style.display = 'block';
}

function renderFeatures(data) {
  const container = document.getElementById('gameFeatures');
  container.innerHTML = '';

  const featureHeaders = [
    'Bonus Buy',
    'Sticky Wilds',
    'Roaming Wilds',
    'Expanding Wilds',
    'Collector',
    'Multipliers',
    'Respins',
    'Cascading',
    'Gamble',
    'Hold&Win',
    'Expanding Symbols',
    'Pays both ways',
    'Book'
  ];

  const displayNames = {
    'Bonus Buy': 'Bonus Buy',
    'Sticky Wilds': 'Sticky Wilds',
    'Roaming Wilds': 'Roaming Wilds',
    'Expanding Wilds': 'Expanding Wilds',
    'Collector': 'Collector',
    'Multipliers': 'Multipliers',
    'Respins': 'Respins',
    'Cascading': 'Cascading',
    'Gamble': 'Gamble',
    'Hold&Win': 'Hold & Win',
    'Expanding Symbols': 'Expanding Symbols',
    'Pays both ways': 'Pays Both Ways',
    'Book': 'Book'
  };

  /*
   * Code.gs returns an array containing only the enabled features.
   * This also accepts the old object format so the UI remains compatible
   * with any cached/older response.
   */
  const rawFeatures = data && data.features;
  let enabledFeatures = [];

  if (Array.isArray(rawFeatures)) {
    enabledFeatures = rawFeatures.map(function(feature) {
      return String(feature || '').trim();
    });
  } else if (rawFeatures && typeof rawFeatures === 'object') {
    enabledFeatures = featureHeaders.filter(function(feature) {
      return !!rawFeatures[feature];
    });
  }

  featureHeaders.forEach(function(feature) {
    const displayName = displayNames[feature] || feature;
    const isEnabled =
      enabledFeatures.indexOf(feature) !== -1 ||
      enabledFeatures.indexOf(displayName) !== -1;

    if (!isEnabled) return;

    const item = document.createElement('span');
    item.className = 'feature-badge';
    item.textContent = displayName;
    container.appendChild(item);
  });

  if (!container.children.length) {
    container.innerHTML = '<span class="no-features">-</span>';
  }
}

function loadExternalWeeklyGameData(week, game, cluster, silent) {
  apiRequest('viewerData', { week: week, date: currentDate, cluster: cluster, game: game })
    .then(function(data) {
      if (currentWeek !== week || currentCluster !== cluster || currentGame !== game) return;
      renderExternalWeeklyGameData(data.external || { found: false, gameId: '', details: [] });
    })
    .catch(function(error) {
      console.error('viewerData external error:', error);
      if (!silent) renderExternalWeeklyGameData({ found: false, gameId: '', details: [] });
    });
}

function renderExternalWeeklyGameData(data) {
  const gameIdElement = document.getElementById('selectedGameId');
  const section = document.getElementById('futureDataSection');
  let html = '<h3>Game Data</h3><div class="external-data-table">';
  const thumbnailsReceived = window.currentGameDetails && window.currentGameDetails.thumbnailsReceived;
  html += '<div class="external-data-row"><div class="external-data-label">Thumbnails Received</div><div class="external-data-value">' + escapeHtml(displayDash(thumbnailsReceived)) + '</div></div>';
  if (data && data.found) {
    if (data.sheetName) html += '<div class="external-sheet-info">' + escapeHtml(data.sheetName) + '</div>';
    (data.details || []).forEach(function(item) {
      html += '<div class="external-data-row"><div class="external-data-label">' + escapeHtml(item.header) + '</div><div class="external-data-value">' + escapeHtml(displayDash(item.value)) + '</div></div>';
    });
  } else html += '<div class="external-sheet-info">No external game data found.</div>';
  html += '</div>';
  section.innerHTML = html;
}

function formatDateForDisplay(value) {
  if (!value) return '';
  const parts = String(value).split('-');
  return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : value;
}

function displayDash(value) {
  return value === null || value === undefined || String(value).trim() === '' ? '-' : String(value);
}

function sameGame(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function hideDetails() {
  document.getElementById('details').style.display = 'none';
  ['selectedGame','selectedStudio','selectedType','selectedReleaseNotes','selectedSlug','selectedTag'].forEach(function(id) { document.getElementById(id).textContent = ''; });
  document.getElementById('selectedGameId').textContent = '-';
  document.getElementById('futureDataSection').innerHTML = '';
  document.getElementById('availableBrands').innerHTML = '';
  document.getElementById('gameFeatures').innerHTML = '';
  window.currentGameDetails = null;
}

function setStatus(message, type) {
  const element = document.getElementById('status');
  if (!element) return;
  element.textContent = message || '';
  element.className = 'status';
  if (type) element.classList.add(type);
}

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error || 'Unknown error');
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
