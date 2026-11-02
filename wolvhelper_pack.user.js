// ==UserScript==
// @name        Wolvhelper Pack: Wolvden Userscripts
// @namespace   https://github.com/Kaztaztrophe/Wolvhelper
// @version     2.0.0
// @author      Kaztaztrophe
// @description Wolvden userscript package with customizable settings panel to configure active mods
// @match       https://www.wolvden.com/*
// @match       https://wolvden.com/*
// @run-at      document-start
// @grant       GM_getResourceText
// @resource    whGlobalStyles https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/global.min.css?v=2.0.0
// @updateURL   https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/wolvhelper_pack.user.js
// @downloadURL https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/wolvhelper_pack.user.js
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '2.0.0';
  const CACHE_KEY = 'wolvhelper_pack_cache';
  const SETTINGS_KEY = 'wolvhelper_pack_settings';
  const CACHE_SCHEMA = 6; // Bumped when shape of JSON files change
  const UPDATE_COOLDOWN = 10 * 60 * 1000; // 10 minutes
  const FETCH_TIMEOUT = 10 * 1000; // 10 seconds

  const CSS_GLOBAL_CUSTOM = ``;
  const CSS_GLOBAL_RESOURCE = typeof GM_getResourceText === 'function' ? GM_getResourceText('whGlobalStyles') : '';

  const URL_ENCOUNTERS = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/encounters.json';
  const URL_IMAGES = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/images.json';
  const URL_POOLS = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/pools.json';
  const URL_TROPHIES = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/trophies.json';

  const GH_IMAGES = 'https://grousehouse.wiki/images';
  const IMAGE_LABELS = { 'imgsc': 'Silver Cones', 'imglt': 'Lunar Tears', 'imglb': 'Lovebugs', 'imggp': 'Glow Petals', 'imgcs': 'Cryptid Scales', 'imgmt': 'Megalodon Teeth', 'imgme': 'Mysterious Effigies', 'imgsq': 'Smoky Quartz' };

  const MST_OFFSET_MS = -7 * 60 * 60 * 1000; // Mountain Standard Time (MST) offset: UTC-7
  const WDT_OFFSET_MS = -20 * 1000; // Average Wolvden Time (WDT) offset: -20 seconds
  const HOUR_MS = 3600 * 1000; // 1 hour
  const DAY_MS = 24 * HOUR_MS; // 24 hours
  const SEASON_ANCHOR_MS = Date.UTC(2026, 5, 15, 0, 0, 0); // June 15, 2026 00:00 WDT (Spring)
  const SEASON_ORDER = ['Spring', 'Summer', 'Autumn', 'Winter'];

  function getSettings() {
    const defaults = { enabled: true, mini: false, encounters: true, notes: true, trophies: true, images: true, grouped: true, spacing: true };
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      const images = parsed.images !== false;
      const grouped = parsed.grouped !== false;
      const spacing = parsed.spacing !== false;
      let mini = parsed.mini ?? false;
      if (!images && !grouped && !spacing) {
        mini = true;
      }
      return {
        enabled: parsed.enabled !== false,
        mini: mini,
        encounters: parsed.encounters !== false,
        notes: parsed.notes !== false,
        trophies: parsed.trophies !== false,
        images: images,
        grouped: grouped,
        spacing: spacing
      };
    } catch {
      return defaults;
    }
  }

  function getFormatting() {
    const settings = getSettings();
    if (settings.mini) {
      return { ...settings, images: false, grouped: false, spacing: false };
    }
    return settings;
  }

  function saveSetting(key, value) {
    const settings = getSettings();
    settings[key] = value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function injectStyles() {
    if (document.getElementById('wh-global-styles')) return;
    const styleElement = document.createElement('style');
    styleElement.id = 'wh-global-styles';
    styleElement.textContent = CSS_GLOBAL_RESOURCE + '\n' + CSS_GLOBAL_CUSTOM;
    (document.head || document.documentElement).appendChild(styleElement);
  }

  function injectPanel() {
    const currentPath = window.location.pathname;
    if (!currentPath.startsWith('/profile/') && !currentPath.startsWith('/den/')) return;

    const unorderedList = document.querySelector('ul.nav.nav-tabs');
    if (!unorderedList || document.querySelector('#wh-nav-container')) return;

    const userButton = document.querySelector('nav.navbar-status button.dropdown-toggle, .navbar-status .dropdown-toggle');
    if (!userButton) return;
    const userName = userButton.textContent.trim();

    const navText = unorderedList.textContent || '';
    if (!navText.includes(userName)) return;

    const listItem = document.createElement('li');
    listItem.id = 'wh-nav-container';
    listItem.className = 'nav-item ml-auto';
    listItem.style.position = 'relative';

    const settings = getSettings();
    const versionLabel = !settings.enabled ? 'Disabled' : (settings.mini ? `WolvhelperMini v${SCRIPT_VERSION}` : `Wolvhelper v${SCRIPT_VERSION}`);

    listItem.innerHTML = `
      <a href="" id="wh-settings-toggle" class="nav-link"><i class="fas fa-cog"></i><span class="d-none d-md-inline ml-1"> Wolvhelper</span><span class="d-none d-sm-inline d-md-none ml-1"> WH</span></a>
      <div class="card bg-light border shadow-sm" id="wh-settings-panel">
        <div class="card-body p-3">
          <div id="wh-version-display" class="font-weight-normal mb-1"><b>Version</b> (${versionLabel})</div>
          <div id="wh-mods-container" class="${!settings.enabled ? 'wh-panel-disabled' : ''}">
            <div class="custom-control custom-checkbox pb-1">
              <input type="checkbox" class="custom-control-input" id="wh-toggle-mini" ${settings.mini ? 'checked' : ''} ${!settings.enabled ? 'disabled' : ''}>
              <label class="custom-control-label" for="wh-toggle-mini">WolvhelperMini</label>
            </div>
          </div>
          <div id="wh-mods-container-main" class="${!settings.enabled ? 'wh-panel-disabled' : ''}">
            <hr class="my-2">
            <div class="font-weight-bold mb-2">Exploring</div>
            <div class="custom-control custom-checkbox">
              <input type="checkbox" class="custom-control-input" id="wh-toggle-encounters" ${settings.encounters ? 'checked' : ''} ${!settings.enabled ? 'disabled' : ''}>
              <label class="custom-control-label" for="wh-toggle-encounters">Explore Encounters</label>
            </div>
            <div class="custom-control custom-checkbox ml-4">
              <input type="checkbox" class="custom-control-input" id="wh-toggle-notes" ${settings.notes ? 'checked' : ''} ${(!settings.encounters || !settings.enabled) ? 'disabled' : ''}>
              <label class="custom-control-label ${(!settings.encounters && settings.enabled) ? 'wh-panel-disabled' : ''}" id="wh-label-notes" for="wh-toggle-notes">Encounter Notes</label>
            </div>
            <div class="custom-control custom-checkbox">
              <input type="checkbox" class="custom-control-input" id="wh-toggle-trophies" ${settings.trophies ? 'checked' : ''} ${!settings.enabled ? 'disabled' : ''}>
              <label class="custom-control-label" for="wh-toggle-trophies">Enemy Trophies</label>
            </div>
            <div class="font-weight-bold pt-2 mb-1">Exploring Format</div>
            <div id="wh-explore-sub-container" class="mb-2 pl-4 ${(!settings.enabled || settings.mini) ? 'wh-panel-disabled' : ''}">
              <div class="custom-control custom-checkbox">
                <input type="checkbox" class="custom-control-input" id="wh-toggle-images" ${settings.images ? 'checked' : ''} ${(!settings.enabled || settings.mini) ? 'disabled' : ''}>
                <label class="custom-control-label" for="wh-toggle-images">Item Images (grousehouse.wiki)</label>
              </div>
              <div class="custom-control custom-checkbox">
                <input type="checkbox" class="custom-control-input" id="wh-toggle-grouped" ${settings.grouped ? 'checked' : ''} ${(!settings.enabled || settings.mini) ? 'disabled' : ''}>
                <label class="custom-control-label" for="wh-toggle-grouped">Grouped Elements</label>
              </div>
              <div class="custom-control custom-checkbox">
                <input type="checkbox" class="custom-control-input" id="wh-toggle-spacing" ${settings.spacing ? 'checked' : ''} ${(!settings.enabled || settings.mini) ? 'disabled' : ''}>
                <label class="custom-control-label" for="wh-toggle-spacing">Increased Spacing</label>
              </div>
            </div>
          </div>
          <hr class="my-2">
          <div class="custom-control custom-checkbox">
            <input type="checkbox" class="custom-control-input" id="wh-toggle-disable" ${!settings.enabled ? 'checked' : ''}>
            <label class="custom-control-label font-weight-bold" for="wh-toggle-disable">Disable Wolvhelper</label>
          </div>
        </div>
      </div>
    `;

    unorderedList.appendChild(listItem);

    const toggleLink = listItem.querySelector('#wh-settings-toggle');
    const wolvhelperPanel = listItem.querySelector('#wh-settings-panel');
    const versionDisplay = listItem.querySelector('#wh-version-display');
    const modsContainer = listItem.querySelector('#wh-mods-container');
    const modsContainerMain = listItem.querySelector('#wh-mods-container-main');
    const exploreSubContainer = listItem.querySelector('#wh-explore-sub-container');

    const miniCheckbox = listItem.querySelector('#wh-toggle-mini');
    const encountersCheckbox = listItem.querySelector('#wh-toggle-encounters');
    const notesCheckbox = listItem.querySelector('#wh-toggle-notes');
    const notesLabel = listItem.querySelector('#wh-label-notes');
    const trophiesCheckbox = listItem.querySelector('#wh-toggle-trophies');
    const imagesCheckbox = listItem.querySelector('#wh-toggle-images');
    const groupedCheckbox = listItem.querySelector('#wh-toggle-grouped');
    const spacingCheckbox = listItem.querySelector('#wh-toggle-spacing');
    const disableCheckbox = listItem.querySelector('#wh-toggle-disable');

    const featureCheckboxes = [miniCheckbox, encountersCheckbox, trophiesCheckbox];
    const formatCheckboxes = [imagesCheckbox, groupedCheckbox, spacingCheckbox];

    function updatePanelUI(enabled) {
      const isMini = miniCheckbox.checked;

      modsContainer.classList.toggle('wh-panel-disabled', !enabled);
      modsContainerMain.classList.toggle('wh-panel-disabled', !enabled);
      exploreSubContainer.classList.toggle('wh-panel-disabled', !enabled || isMini);

      featureCheckboxes.forEach(checkbox => { checkbox.disabled = !enabled; });
      formatCheckboxes.forEach(checkbox => { checkbox.disabled = !enabled || isMini; });

      notesCheckbox.disabled = !enabled || !encountersCheckbox.checked;
      notesLabel.classList.toggle('wh-panel-disabled', enabled && !encountersCheckbox.checked);
    }

    function checkAllExploreUnchecked() {
      if (!imagesCheckbox.checked && !groupedCheckbox.checked && !spacingCheckbox.checked) {
        miniCheckbox.checked = true;
        saveSetting('mini', true);
        exploreSubContainer.classList.add('wh-panel-disabled');
        formatCheckboxes.forEach(checkbox => { checkbox.disabled = true; });
        versionDisplay.innerHTML = `<b>Version</b> (WolvhelperMini v${SCRIPT_VERSION})`;
      }
    }

    toggleLink.addEventListener('click', (event) => {
      event.preventDefault();
      const isHidden = window.getComputedStyle(wolvhelperPanel).display === 'none';
      wolvhelperPanel.style.display = isHidden ? 'block' : 'none';
      toggleLink.classList.toggle('active', isHidden);
      toggleLink.blur();
    });

    document.addEventListener('click', (event) => {
      if (!listItem.contains(event.target)) {
        wolvhelperPanel.style.display = 'none';
        toggleLink.classList.remove('active');
      }
    });

    miniCheckbox.addEventListener('change', (event) => {
      const isMini = event.target.checked;
      saveSetting('mini', isMini);
      exploreSubContainer.classList.toggle('wh-panel-disabled', isMini);
      formatCheckboxes.forEach(checkbox => { checkbox.disabled = isMini; });

      if (isMini) {
        formatCheckboxes.forEach(checkbox => { checkbox.checked = false; });
      } else {
        const current = getSettings();
        imagesCheckbox.checked = current.images;
        groupedCheckbox.checked = current.grouped;
        spacingCheckbox.checked = current.spacing;
      }

      versionDisplay.innerHTML = `<b>Version</b> (${isMini ? 'WolvhelperMini' : 'Wolvhelper'} v${SCRIPT_VERSION})`;
      checkExploreOutput();
    });

    encountersCheckbox.addEventListener('change', (event) => {
      const encountersValue = event.target.checked;
      saveSetting('encounters', encountersValue);
      notesCheckbox.disabled = !encountersValue;
      notesLabel.classList.toggle('wh-panel-disabled', !encountersValue);
      checkExploreOutput();
    });

    notesCheckbox.addEventListener('change', (event) => {
      saveSetting('notes', event.target.checked);
      checkExploreOutput();
    });

    trophiesCheckbox.addEventListener('change', (event) => {
      saveSetting('trophies', event.target.checked);
      checkExploreOutput();
    });

    imagesCheckbox.addEventListener('change', (event) => {
      saveSetting('images', event.target.checked);
      checkAllExploreUnchecked();
      checkExploreOutput();
    });

    groupedCheckbox.addEventListener('change', (event) => {
      saveSetting('grouped', event.target.checked);
      checkAllExploreUnchecked();
      checkExploreOutput();
    });

    spacingCheckbox.addEventListener('change', (event) => {
      saveSetting('spacing', event.target.checked);
      checkAllExploreUnchecked();
      checkExploreOutput();
    });

    disableCheckbox.addEventListener('change', (event) => {
      const isEnabled = !event.target.checked;
      saveSetting('enabled', isEnabled);
      updatePanelUI(isEnabled);

      const currentSettings = getSettings();
      const activeVersionLabel = !isEnabled ? 'Disabled' : (currentSettings.mini ? `WolvhelperMini v${SCRIPT_VERSION}` : `Wolvhelper v${SCRIPT_VERSION}`);
      versionDisplay.innerHTML = `<b>Version</b> (${activeVersionLabel})`;

      if (!isEnabled) {
        clearExploreHelper(true);
      } else {
        checkExploreOutput();
      }
    });
  }

  function getWolvdenNow() {
    const userCard = document.querySelector('#card-user');
    if (userCard) {
      const textContent = userCard.innerHTML.replace(/<br\s*[\/]?>/gi, ' ');
      const dateMatch = textContent.match(/(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,\s+\d{4})/);
      const timeMatch = textContent.match(/(\d{2}:\d{2})/);
      if (dateMatch && timeMatch) {
        const cleanDate = dateMatch[1].replace(/(st|nd|rd|th)/g, '').trim();
        const parsedMs = new Date(`${cleanDate} ${timeMatch[1]} UTC`).getTime();
        if (!isNaN(parsedMs)) return new Date(parsedMs);
      }
    }
    return new Date(Date.now() + MST_OFFSET_MS + WDT_OFFSET_MS);
  }

  function getSeasonSchedule(liveNow = getWolvdenNow()) {
    const targetDayUtc = Date.UTC(liveNow.getUTCFullYear(), liveNow.getUTCMonth(), liveNow.getUTCDate());
    const elapsedDays = Math.floor((targetDayUtc - SEASON_ANCHOR_MS) / DAY_MS);
    const cycleDay = ((elapsedDays % 24) + 24) % 24;
    const activeSeasonIndex = Math.floor(cycleDay / 6);
    const dayInSeason = cycleDay % 6;
    const activeSeasonStartMs = targetDayUtc - dayInSeason * DAY_MS;

    return {
      seasonName: SEASON_ORDER[activeSeasonIndex],
      activeSeasonIndex,
      activeSeasonStartMs
    };
  }

  let encounterDatabase = null;
  let encounterIdLookup = [];
  let enemyDatabase = null;
  let enemyIdLookup = [];
  let activeEncounterId = null;
  let activeEncounterSubId = null;
  let activeEncounterIndex = 0;
  let isPending = false;
  let lastSignature = '';

  async function fetchData(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  let databaseRequested = false;

  function ensureDatabase() {
    if (databaseRequested) return;
    databaseRequested = true;
    loadDatabase();
  }

  async function loadDatabase() {
    const cachedData = localStorage.getItem(CACHE_KEY);
    let loadedFromCache = false;

    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData);
        if (parsed.schema === CACHE_SCHEMA && parsed.encounterDatabase && parsed.encounterDatabase.encounters) {
          encounterDatabase = parsed.encounterDatabase;
          enemyDatabase = parsed.enemyDatabase;

          buildLookups();
          checkExploreOutput();
          loadedFromCache = true;

          if (Date.now() - parsed.timestamp < UPDATE_COOLDOWN) {
            return;
          }
        }
      } catch (error) {
        console.warn('[Wolvhelper] Cache corrupted, resetting.', error);
      }
    }

    try {
      const [encountersResult, imagesResult, poolsResult, trophiesResult] = await Promise.allSettled([
        fetchData(URL_ENCOUNTERS), fetchData(URL_IMAGES), fetchData(URL_POOLS), fetchData(URL_TROPHIES)
      ]);

      const useResult = (result, fallback, name) => {
        if (result.status === 'fulfilled') return result.value;
        console.warn(`[Wolvhelper] Could not update ${name}:`, result.reason);
        return fallback;
      };

      const encounterData = useResult(encountersResult, encounterDatabase && { encounters: encounterDatabase.encounters }, 'encounters.json');
      if (!encounterData) throw new Error('[Wolvhelper] Could not download encounters.json');

      const imagesData = useResult(imagesResult, null, 'images.json');
      const rawImages = imagesData?.images ?? imagesData ?? encounterDatabase?.images ?? {};
      encounterData.images = flattenImageTree(rawImages);

      const poolsData = useResult(poolsResult, null, 'pools.json');
      encounterData.pools = poolsData?.pools ?? poolsData ?? encounterDatabase?.pools ?? {};

      const enemyData = useResult(trophiesResult, enemyDatabase, 'trophies.json');

      if (!encounterData.encounters || typeof encounterData.encounters !== 'object') {
        throw new Error('[Wolvhelper] Downloaded database is missing "encounters"');
      }
      if (!enemyData?.trophies || typeof enemyData.trophies !== 'object') {
        throw new Error('[Wolvhelper] Downloaded database is missing "trophies"');
      }

      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          schema: CACHE_SCHEMA,
          timestamp: Date.now(),
          encounterDatabase: encounterData,
          enemyDatabase: enemyData
        }));
      } catch (error) {
        console.warn('[Wolvhelper] Could not write cache.', error);
      }

      encounterDatabase = encounterData;
      enemyDatabase = enemyData;
      baseImageElementCache.clear();

      buildLookups();
      lastSignature = '';
      checkExploreOutput();

    } catch (error) {
      if (!loadedFromCache) {
        console.error('[Wolvhelper] Failed to load database:', error);
      }
    }
  }

  function buildLookups() {
    encounterIdLookup = [];
    for (const [key, data] of Object.entries(encounterDatabase.encounters)) {
      const multiIds = key.split('|').map(idSegment => idSegment.trim());
      let prompts = [];
      if (Array.isArray(data?.prompt)) {
        prompts = data.prompt.map(normalizeText);
      } else if (typeof data?.prompt === 'string' && data.prompt.trim()) {
        prompts = data.prompt.split('|').map(normalizeText);
      }
      multiIds.forEach((segment, index) => {
        const slashParts = segment.split('/').map(part => part.trim());
        const rawPreferredId = slashParts[0];
        const rawFunctionalId = slashParts.length > 1 ? slashParts[1] : slashParts[0];

        let pathFolder = null;
        let cleanFunctionalId = rawFunctionalId;
        if (rawFunctionalId.includes(':')) {
          const colonParts = rawFunctionalId.split(':').map(part => part.trim());
          pathFolder = colonParts[0].toLowerCase();
          cleanFunctionalId = colonParts[1];
        }

        const preferredId = rawPreferredId.includes(':')
          ? rawPreferredId.split(':')[1].trim()
          : rawPreferredId;

        encounterIdLookup.push({
          id: key,
          subId: preferredId,
          matchId: cleanFunctionalId,
          pathFolder: pathFolder,
          index: index,
          normalized: normalizeText(cleanFunctionalId),
          prompts: prompts
        });
      });
    }

    encounterIdLookup.sort((a, b) => {
      if (Boolean(a.pathFolder) !== Boolean(b.pathFolder)) {
        return a.pathFolder ? -1 : 1;
      }
      return b.normalized.length - a.normalized.length;
    });

    if (enemyDatabase?.trophies) {
      enemyIdLookup = Object.keys(enemyDatabase.trophies)
        .map(id => ({ id, normalized: normalizeText(id), normalizedName: normalizeText(enemyDatabase.trophies[id]?.name || '') }))
        .sort((a, b) => Math.max(b.normalized.length, b.normalizedName.length) - Math.max(a.normalized.length, a.normalizedName.length));
    }
  }

  function normalizeText(text) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function isStepOption(optionValue) {
    return optionValue && typeof optionValue === 'object' && !Array.isArray(optionValue) &&
      (Array.isArray(optionValue.steps) || Array.isArray(optionValue.results));
  }

  function getCurrentEnemyName(output = document.querySelector('#explore-output')) {
    if (!output) return null;
    const enemyData = findEnemy(output);
    if (enemyData?.name) return enemyData.name;

    const paragraphsText = Array.from(output.querySelectorAll('p')).map(paragraph => paragraph.textContent);
    const enemyParagraph = paragraphsText.find(text => /oh\s+no!/i.test(text));
    if (enemyParagraph) {
      const enemyMatch = enemyParagraph.match(/enemy\s+([^!]+)/i);
      if (enemyMatch) return enemyMatch[1].trim();
    }
    return null;
  }

  function getCurrentSeason() {
    const seasonIcon = document.querySelector('img.seasonIcon[data-original-title], img.seasonIcon[title], img.seasonIcon');
    if (seasonIcon) {
      const title = (seasonIcon.getAttribute('data-original-title') || seasonIcon.getAttribute('title') || '').toLowerCase();
      const titleMatch = title.match(/\b(spring|summer|autumn|winter)\b/);
      if (titleMatch) return titleMatch[1];

      const sourceImage = (seasonIcon.getAttribute('src') || '').toLowerCase();
      const sourceMatch = sourceImage.match(/icon-season-(spring|summer|autumn|winter)/);
      if (sourceMatch) return sourceMatch[1];
    }
    return getSeasonSchedule().seasonName.toLowerCase();
  }

  function matchScore(buttonText, optionName) {
    const cleanButton = buttonText.replace(/\s*\[.*?\]|\s*\(.*?\)/g, '').trim();
    const seasonalMatch = optionName.match(/\s*\[(spring|summer|autumn|winter)\]$/i);
    if (seasonalMatch) {
      const optionSeason = seasonalMatch[1].toLowerCase();
      const currentSeason = getCurrentSeason();
      if (currentSeason && currentSeason !== optionSeason) return 0;
      optionName = optionName.slice(0, seasonalMatch.index).trim();
    }
    const normalizedButton = normalizeText(cleanButton);
    const normalizedOption = normalizeText(optionName);
    if (!normalizedOption) return 0;
    if (normalizedButton === normalizedOption) return 1000 + normalizedOption.length;
    return normalizedButton.startsWith(normalizedOption) ? normalizedOption.length : 0;
  }

  function matchOptionName(buttonText, optionName) {
    return matchScore(buttonText, optionName) > 0;
  }

  function getPlayerLevel() {
    const levelElement = [...document.querySelectorAll('#card-user .card-body b')]
      .find(element => element.parentElement?.textContent.includes('Level'));
    if (!levelElement) return null;
    const level = Number(levelElement.textContent.trim());
    return Number.isFinite(level) ? level : null;
  }

  function resolveLevelExpressions(text) {
    const level = getPlayerLevel();
    if (level === null) return text.replace(/\(LVL\s*([+*])\s*(\d+)\)/gi, 'LVL$1$2');
    return text.replace(/\(LVL\s*([+*])\s*(\d+)\)/gi, (match, operator, number) => {
      const value = Number(number);
      if (operator === '+') return String(level + value);
      if (operator === '*') return String(level * value);
      return match;
    });
  }

  function getLocationValues(location) {
    if (!location || typeof location !== 'object') return [];
    const currentPath = window.location.pathname.replace(/\/+$/, '');
    for (const [locationPaths, value] of Object.entries(location)) {
      const paths = locationPaths.split('|').map(path => path.trim().replace(/\/+$/, ''));
      if (paths.some(path => currentPath === path || currentPath.startsWith(path + '/'))) {
        return Array.isArray(value) ? value : value ? [value] : [];
      }
    }
    return [];
  }

  function resolveReferences(text, location) {
    const locationValues = getLocationValues(location);
    const settings = getSettings();
    let previousText;
    let maxDepth = 10;
    do {
      previousText = text;
      text = text.replace(/(\**)\@([a-zA-Z0-9_]+)/g, (match, prefix, key) => {
        if (key.toLowerCase() === 'enemy') {
          const enemyName = getCurrentEnemyName();
          return enemyName ? prefix + enemyName : match;
        }
        const locationMatch = key.match(/^location(\d+)$/);
        if (locationMatch) {
          const index = Number(locationMatch[1]) - 1;
          return locationValues[index] !== undefined ? prefix + locationValues[index] : match;
        }
        if (encounterDatabase.pools?.[key]) return prefix + encounterDatabase.pools[key];
        if (encounterDatabase.notes?.[key]) {
          if (!settings.notes) return '';
          return prefix + encounterDatabase.notes[key];
        }
        return match;
      });
      maxDepth--;
    } while (text !== previousText && maxDepth > 0);

    if (!settings.notes) {
      text = text.replace(/\*+/g, '');
    }

    return text;
  }

  let activeEncounterMatchId = null;

  function matchesPathFolder(entry, lowerUrl) {
    if (!entry.pathFolder) return true;
    return lowerUrl.includes(`/${entry.pathFolder}/`);
  }

  function findEncounterDataByMergeKey(mergeKey) {
    if (!mergeKey || !encounterDatabase?.encounters) return null;
    const cleanKey = String(mergeKey).replace(/^@/, '').trim();
    if (encounterDatabase.encounters[cleanKey]) {
      return { id: cleanKey, data: encounterDatabase.encounters[cleanKey] };
    }
    const normalizedKey = normalizeText(cleanKey);
    const lookupMatch = encounterIdLookup.find(
      entry => entry.id === cleanKey || entry.subId === cleanKey || entry.matchId === cleanKey || entry.normalized === normalizedKey
    );
    return lookupMatch ? { id: lookupMatch.id, data: encounterDatabase.encounters[lookupMatch.id] } : null;
  }

  function getResolvedEncounterData(encounterId, visited = new Set()) {
    const baseData = encounterDatabase?.encounters?.[encounterId];
    if (!baseData || visited.has(encounterId)) return baseData || null;
    visited.add(encounterId);

    if (!baseData.merge) return baseData;

    const rawTargets = Array.isArray(baseData.merge) ? baseData.merge : [baseData.merge];
    const mergeTargets = [];
    rawTargets.forEach(target => {
      if (findEncounterDataByMergeKey(target)) {
        mergeTargets.push(target);
      } else {
        mergeTargets.push(...String(target).split('|').map(s => s.trim()).filter(Boolean));
      }
    });

    const mergedSteps = { ...(baseData.steps || {}) };
    const mergedLocation = { ...(baseData.location || {}) };
    const mergedConditional = { ...(baseData.conditional || {}) };
    let mergedNotes = baseData.notes;
    let mergedDetails = baseData.details;
    let mergedTrophies = baseData.trophies;

    for (const targetKey of mergeTargets) {
      const targetMatch = findEncounterDataByMergeKey(targetKey);
      if (!targetMatch || visited.has(targetMatch.id)) continue;

      const resolvedTarget = getResolvedEncounterData(targetMatch.id, new Set(visited));
      if (!resolvedTarget) continue;

      for (const [optName, optValue] of Object.entries(resolvedTarget.options || {})) {
        if (mergedSteps[optName] === undefined) {
          mergedSteps[optName] = optValue;
        }
      }
      for (const [stepName, stepValue] of Object.entries(resolvedTarget.steps || {})) {
        if (mergedSteps[stepName] === undefined) {
          mergedSteps[stepName] = stepValue;
        }
      }
      Object.assign(mergedLocation, resolvedTarget.location || {}, mergedLocation);
      Object.assign(mergedConditional, resolvedTarget.conditional || {}, mergedConditional);
      if (!mergedNotes && resolvedTarget.notes) mergedNotes = resolvedTarget.notes;
      if (!mergedDetails && resolvedTarget.details) mergedDetails = resolvedTarget.details;
      if (!mergedTrophies && resolvedTarget.trophies) mergedTrophies = resolvedTarget.trophies;
    }

    return {
      ...baseData,
      steps: mergedSteps,
      location: Object.keys(mergedLocation).length ? mergedLocation : baseData.location,
      conditional: Object.keys(mergedConditional).length ? mergedConditional : baseData.conditional,
      notes: mergedNotes,
      details: mergedDetails,
      trophies: mergedTrophies
    };
  }

  function findEncounterByImage() {
    const foreground = document.querySelector('#explore-foreground');
    const backgroundImage = foreground?.style.backgroundImage;
    if (!backgroundImage) return null;

    const lowerUrl = backgroundImage.toLowerCase();
    const match = backgroundImage.match(/\/([^\/?#]+)\.(?:png|jpg|jpeg|webp)(?:[?#][^"')]*)?["')]*$/i);
    if (!match) return null;
    let filename = match[1].toLowerCase().replace(/[_-]/g, '');
    if (filename === 'blank' || filename === 'hiddenart') return null;

    filename = filename.replace(/(?:spring|summer|autumn|winter)?(?:day|dawn|dusk|night)$|(?:spring|summer|autumn|winter)$/i, '');

    const isEnemyUrl = lowerUrl.includes('/enemies/');

    const entry = encounterIdLookup.find(encounter => matchesPathFolder(encounter, lowerUrl) && filename === encounter.normalized) ||
      (!isEnemyUrl ? encounterIdLookup.find(encounter => matchesPathFolder(encounter, lowerUrl) && encounter.normalized.length >= 5 && filename.includes(encounter.normalized)) : null);

    if (!entry && isEnemyUrl) {
      return null;
    }

    return entry ? { id: entry.id, subId: entry.subId, matchId: entry.matchId, index: entry.index, data: getResolvedEncounterData(entry.id) } : null;
  }

  function findEncounterIdFromAction(action) {
    if (!action || encounterIdLookup.length === 0) return null;
    const lowerUrl = (document.querySelector('#explore-foreground')?.style.backgroundImage || '').toLowerCase();
    const rawAction = action.toLowerCase();
    const actionTokens = rawAction.split(/[^a-z0-9]+/).filter(Boolean);
    const normalizedAction = normalizeText(rawAction);
    for (const entry of encounterIdLookup) {
      if (!matchesPathFolder(entry, lowerUrl)) continue;
      if (actionTokens.includes(entry.normalized)) return entry;
      if (entry.normalized.length >= 5 && normalizedAction.includes(entry.normalized)) return entry;
      if (entry.normalized.startsWith('filler')) {
        const fillerSuffix = entry.normalized.slice(6);
        if (actionTokens.includes('filler_' + fillerSuffix) || (actionTokens.includes('filler') && actionTokens.includes(fillerSuffix))) {
          return entry;
        }
      }
    }
    return null;
  }

  function findEncounterByButton(output) {
    const buttons = output.querySelectorAll('button');
    for (const button of buttons) {
      const action = button.dataset.action;
      const entry = findEncounterIdFromAction(action);
      if (entry && encounterDatabase.encounters[entry.id]) {
        return { id: entry.id, subId: entry.subId, matchId: entry.matchId, index: entry.index, data: getResolvedEncounterData(entry.id) };
      }
    }
    return null;
  }

  function findEncounterByPrompt(output) {
    const lowerUrl = (document.querySelector('#explore-foreground')?.style.backgroundImage || '').toLowerCase();
    const normalizedParagraphs = Array.from(output.querySelectorAll('p')).map(paragraph => normalizeText(paragraph.textContent));
    for (const entry of encounterIdLookup) {
      if (!matchesPathFolder(entry, lowerUrl)) continue;
      if (!entry.prompts || entry.prompts.length === 0) continue;
      const matched = entry.prompts.some(target => target && normalizedParagraphs.some(paragraphText => paragraphText.includes(target)));
      if (matched) return { id: entry.id, subId: entry.subId, matchId: entry.matchId, index: entry.index, data: getResolvedEncounterData(entry.id) };
    }
    return null;
  }

  function encounterMatchesButtons(encounter, output) {
    const optionNames = Object.keys(encounter.data.options || {});
    const stepNames = Object.keys(encounter.data.steps || {}).map(normalizeText);
    return [...output.querySelectorAll('button')].some(button => {
      const buttonText = button.textContent.trim();
      const cleanButton = buttonText.replace(/\s*\[.*?\]|\s*\(.*?\)/g, '').trim();
      return optionNames.some(name => matchOptionName(buttonText, name)) || stepNames.includes(normalizeText(cleanButton));
    });
  }

  function findCurrentEncounter(output) {
    const newResult = findEncounterByImage() || findEncounterByButton(output) || findEncounterByPrompt(output);
    if (newResult) {
      activeEncounterId = newResult.id;
      activeEncounterSubId = newResult.subId;
      activeEncounterMatchId = newResult.matchId;
      activeEncounterIndex = newResult.index;
      return newResult;
    }
    if (activeEncounterId && encounterDatabase.encounters[activeEncounterId]) {
      const defaultSubId = activeEncounterId.split('|')[0].split('/')[0].trim();
      const current = {
        id: activeEncounterId,
        subId: activeEncounterSubId || defaultSubId,
        matchId: activeEncounterMatchId || activeEncounterSubId || defaultSubId,
        index: activeEncounterIndex || 0,
        data: getResolvedEncounterData(activeEncounterId)
      };
      if (encounterMatchesButtons(current, output)) return current;
    }
    activeEncounterId = null;
    activeEncounterSubId = null;
    activeEncounterMatchId = null;
    activeEncounterIndex = 0;
    return null;
  }

  function findEnemy(output) {
    if (!enemyDatabase || !enemyIdLookup.length) return null;

    const foreground = document.querySelector('#explore-foreground');
    if (foreground && foreground.style.backgroundImage) {
      const background = foreground.style.backgroundImage;
      const match = background.match(/\/enemies\/([^\/?#]+)\.(?:png|jpg|jpeg|webp)/i);
      if (match) {
        let rawFilename = match[1].toLowerCase();
        let filename = rawFilename.replace(/[_-]/g, '');
        filename = filename.replace(/(?:spring|summer|autumn|winter)?(?:day|dawn|dusk|night)$|(?:spring|summer|autumn|winter)$/i, '');
        const isCorrupted = /corrupt/i.test(filename);
        let strippedFilename = filename.replace(/^corrupt(ed)?/, '').replace(/corrupt(ed)?$/, '');

        for (const entry of enemyIdLookup) {
          const trophy = enemyDatabase.trophies[entry.id];
          if (!trophy) continue;
          const trophyNormalizedName = normalizeText(trophy.name || entry.id);

          if (filename === entry.normalized || filename === trophyNormalizedName ||
              strippedFilename === entry.normalized || strippedFilename === trophyNormalizedName) {
            if (isCorrupted && !trophy.name?.toLowerCase().startsWith('corrupted')) {
              return { id: entry.id, ...trophy, name: `Corrupted ${trophy.name}` };
            }
            return { id: entry.id, ...trophy };
          }
        }
      }
    }

    const paragraphsText = Array.from(output.querySelectorAll('p')).map(paragraph => paragraph.textContent);
    const enemyParagraph = paragraphsText.find(text => /oh\s+no!/i.test(text));
    if (enemyParagraph) {
      const isCorrupted = /corrupt/i.test(enemyParagraph);
      const enemyMatch = enemyParagraph.match(/enemy\s+([^!]+)/i);
      if (enemyMatch) {
        let rawEnemyName = enemyMatch[1].trim();
        let normalizedExtracted = normalizeText(rawEnemyName);
        let strippedExtracted = normalizedExtracted.replace(/^corrupt(ed)?/, '').replace(/corrupt(ed)?$/, '');

        for (const entry of enemyIdLookup) {
          const trophyObject = enemyDatabase.trophies[entry.id];
          if (!trophyObject) continue;
          const trophyNormalizedName = normalizeText(trophyObject.name || entry.id);

          if (normalizedExtracted === entry.normalized || normalizedExtracted === trophyNormalizedName ||
              strippedExtracted === entry.normalized || strippedExtracted === trophyNormalizedName) {
            if (isCorrupted && !trophyObject.name?.toLowerCase().startsWith('corrupted')) {
              return { id: entry.id, ...trophyObject, name: `Corrupted ${trophyObject.name}` };
            }
            return { id: entry.id, ...trophyObject };
          }
        }
      }
    }

    return null;
  }

  function flattenImageTree(tree, currentPath = '', result = {}) {
    for (const [key, value] of Object.entries(tree)) {
      if (typeof value === 'object' && value !== null) {
        const newPath = currentPath + key + (key.endsWith('/') ? '' : '/');
        flattenImageTree(value, newPath, result);
      } else {
        result[key] = currentPath + value;
      }
    }
    return result;
  }

  const baseImageElementCache = new Map();

  function createRewardImage(imageName, textContext = '', imageIndex = 0, forceMini = false, allowMain = false) {
    const imagePath = encounterDatabase?.images?.[imageName];
    if (!imagePath) return null;
    const settings = getSettings();

    let baseImage = baseImageElementCache.get(imageName);
    if (!baseImage) {
      baseImage = document.createElement('img');
      baseImage.loading = 'lazy';
      baseImage.decoding = 'async';
      baseImage.fetchPriority = 'low';
      baseImage.src = GH_IMAGES + imagePath;
      baseImageElementCache.set(imageName, baseImage);
    }

    const image = baseImage.cloneNode(false);
    image.alt = formatImageLabel(imageName, textContext, imageIndex);

    const useMiniSize = forceMini || settings.mini || !settings.spacing;
    const baseClass = useMiniSize ? 'wh-image-mini' : 'wh-image';
    image.className = (allowMain && imageIndex === 0) ? `wh-image-main ${baseClass}` : baseClass;
    return image;
  }

  function formatImageLabel(imageName, rawTextContext = '', imageIndex = 0) {
    let imageLabel = IMAGE_LABELS[imageName];
    if (!imageLabel) {
      let cleanTitle = rawTextContext.replace(/^[\+\-\d%\s\(\)\*\/]+/, '').trim();
      if (!cleanTitle) {
        cleanTitle = imageName.replace(/^img/, '').replace(/([A-Z])/g, ' $1').trim();
      }
      imageLabel = imageName.startsWith('imgrecipe') ? `Recipe: ${cleanTitle.replace(/^recipe:\s*/i, '')}` : cleanTitle;
    }
    if (imageIndex > 0) imageLabel = imageLabel.replace(/^recipe:\s*/i, '');
    return imageLabel;
  }

  function appendFormattedText(container, text) {
    let lastIndex = 0;
    const elementsToAppend = [];
    for (const match of text.matchAll(/'''([^']+)'''|''([^']+)''/g)) {
      if (match.index > lastIndex) {
        elementsToAppend.push(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      if (match[1] !== undefined) {
        const boldElement = document.createElement('b');
        boldElement.textContent = match[1];
        elementsToAppend.push(boldElement);
      } else if (match[2] !== undefined) {
        const italicElement = document.createElement('i');
        italicElement.textContent = match[2];
        elementsToAppend.push(italicElement);
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      elementsToAppend.push(document.createTextNode(text.slice(lastIndex)));
    }
    container.append(...elementsToAppend);
  }

  function parseSingleReward(value, location, omitImages = false) {
    const resolvedValue = resolveReferences(resolveLevelExpressions(value), location);
    const parts = resolvedValue.split('|');
    const segments = [];
    for (let partIndex = 0; partIndex < parts.length; partIndex += 2) {
      const segment = { text: parts[partIndex] ? parts[partIndex].trim() : '' };
      if (!omitImages) {
        segment.images = parts[partIndex + 1]
          ? parts[partIndex + 1].split(';').map(rawImageKey => rawImageKey.trim().replace(/[^a-zA-Z0-9_-]/g, '')).filter(Boolean)
          : [];
      }
      segments.push(segment);
    }
    return { segments };
  }

  function parseCompoundResult(value, location, omitImages) {
    return value.split('//').reduce((accumulator, part) => {
      const trimmed = part.trim();
      if (trimmed) {
        accumulator.push(parseSingleReward(trimmed, location, omitImages));
      }
      return accumulator;
    }, []);
  }

  function parseResult(value, location) {
    const settings = getFormatting();
    return Array.isArray(value) ? value.map(outcome => parseCompoundResult(outcome, location, !settings.images)) : [parseCompoundResult(value, location, !settings.images)];
  }

  function formatLossMinusSigns(text) {
    return text.replace(
      /(^|[^\d])-(\d+(?:-\d+)?\s*(?:HP\b|%\s*(?:energy|hunger)\b))/gi,
      '$1\u2212$2'
    );
  }

  function createResultElement(rewards, isOr = false) {
    const settings = getFormatting();
    const useGrouped = settings.grouped;
    const TEXT_SPACE = useGrouped ? '\u00A0' : ' ';
    const fragment = document.createDocumentFragment();

    rewards.forEach((reward, index) => {
      let needsSeparator = index > 0;
      let needsOr = isOr && index === 0;
      let currentSpan = null;

      reward.segments.forEach((segment, segmentIndex) => {
        let targetContainer = fragment;
        if (useGrouped) {
          if (!currentSpan || segment.images?.length > 0) {
            currentSpan = document.createElement('span');
            currentSpan.className = 'wh-wrapper-part';
            fragment.appendChild(currentSpan);
          }
          targetContainer = currentSpan;
        }

        if (needsOr) {
          if (!useGrouped) {
            targetContainer.appendChild(document.createElement('wbr'));
          }
          const separator = document.createElement('span');
          separator.textContent = 'OR';
          separator.className = 'wh-separator wh-separator-bold';
          targetContainer.appendChild(separator);
          if (!useGrouped) {
            targetContainer.appendChild(document.createElement('wbr'));
          }
          needsOr = false;
        }
        if (needsSeparator) {
          targetContainer.appendChild(document.createTextNode(TEXT_SPACE + '&' + TEXT_SPACE));
          needsSeparator = false;
        }
        const resultText = segment.text;
        if (resultText) {
          let textToAppend = formatLossMinusSigns(resultText);
          if (segmentIndex > 0 && !/^[*,.;!?/]/.test(resultText)) textToAppend = ' ' + textToAppend;
          const noResultRegex = /No result(\**)/gi;
          let lastIndex = 0;
          let match;
          while ((match = noResultRegex.exec(textToAppend)) !== null) {
            if (match.index > lastIndex) targetContainer.appendChild(document.createTextNode(textToAppend.slice(lastIndex, match.index)));
            const noResult = document.createElement('i');
            noResult.textContent = 'No result';
            targetContainer.appendChild(noResult);
            if (match[1]) targetContainer.appendChild(document.createTextNode(match[1]));
            lastIndex = noResultRegex.lastIndex;
          }
          if (lastIndex < textToAppend.length) targetContainer.appendChild(document.createTextNode(textToAppend.slice(lastIndex)));
        }
        if (settings.images) {
          segment.images?.forEach((imageName, imageIndex) => {
            const image = createRewardImage(imageName, resultText, imageIndex, false, true);
            if (image) {
              targetContainer.appendChild(image);
            }
          });
        }
      });
    });
    return fragment;
  }

  function createTrophiesElement(encounter, buttons, enemyDatabase, output = document.querySelector('#explore-output')) {
    if (!encounter || !encounter.data || !encounter.data.trophies) return null;
    let activeTrophyId = null;
    if (typeof encounter.data.trophies === 'string') {
      const matchesOption = [...buttons].some(button =>
        Object.keys(encounter.data.options || {}).some(optionName => matchOptionName(button.textContent.trim(), optionName))
      );
      const matchesStep = [...buttons].some(button => {
        const cleanButton = button.textContent.replace(/\s*\[.*?\]|\s*\(.*?\)/g, '').trim();
        return Object.keys(encounter.data.steps || {}).some(stepName => normalizeText(cleanButton) === normalizeText(stepName));
      });
      if (matchesOption || matchesStep || !encounter.data.options) {
        activeTrophyId = encounter.data.trophies;
      }
    } else if (typeof encounter.data.trophies === 'object') {
      for (const [stepName, trophyId] of Object.entries(encounter.data.trophies)) {
        if ([...buttons].some(button => matchOptionName(button.textContent.trim(), stepName))) {
          activeTrophyId = trophyId;
          break;
        }
      }
    }
    if (!activeTrophyId) return null;

    let trophyData = null;
    let trophyDisplayName = null;

    if (String(activeTrophyId).trim().toLowerCase() === '@enemy') {
      const detectedEnemy = output ? findEnemy(output) : null;
      if (detectedEnemy) {
        trophyData = detectedEnemy;
        trophyDisplayName = detectedEnemy.name;
      }
    } else {
      const resolvedTrophyId = resolveReferences(String(activeTrophyId), encounter.data.location);
      const rawId = resolvedTrophyId.replace(/^[^a-zA-Z0-9@]+/, '');
      const trophyId = (rawId.startsWith('@') ? rawId.slice(1) : rawId).toLowerCase();
      trophyData = enemyDatabase?.trophies?.[trophyId];
      trophyDisplayName = trophyData?.name || trophyId;
    }

    if (!trophyData) return null;

    const encounterTrophies = document.createElement('div');
    encounterTrophies.className = 'wh-container';
    const trophyHeader = document.createElement('div');
    trophyHeader.className = 'wh-header-enemy';
    const trophyHeaderText = document.createElement('b');
    trophyHeaderText.textContent = `${trophyDisplayName} Trophies`;
    trophyHeader.append(trophyHeaderText);

    const itemsLine = trophyData.drops?.items ? createTrophyLine('Items', trophyData.drops.items) : null;
    const recipesLine = trophyData.drops?.recipes ? createTrophyLine('Recipes', trophyData.drops.recipes) : null;
    encounterTrophies.append(...[trophyHeader, itemsLine, recipesLine].filter(Boolean));
    return encounterTrophies;
  }

  function createStepHeaderLine(buttonText, optionObject, encounter, isIndentedStep = false) {
    const settings = getFormatting();
    const hasResults = Array.isArray(optionObject.results) && optionObject.results.length > 0;
    const steps = Array.isArray(optionObject.steps) ? optionObject.steps : [];

    const previewLine = hasResults
      ? createResultLine(buttonText, parseResult(optionObject.results, encounter.data.location))
      : (() => {
          const line = document.createElement('div');
          line.className = 'wh-line-normal';
          const labelBold = document.createElement('b');
          labelBold.textContent = buttonText + ': ';
          line.appendChild(labelBold);
          return line;
        })();

    if (isIndentedStep) {
      previewLine.className = 'wh-line-step';
    }

    steps.forEach((step, index) => {
      const showSeparator = hasResults || index > 0;
      const stepLabel = document.createElement('b');
      stepLabel.textContent = step;

      if (settings.grouped && hasResults) {
        const partWrapper = document.createElement('span');
        partWrapper.className = 'wh-wrapper-part';
        if (showSeparator) {
          const separator = document.createElement('span');
          separator.textContent = hasResults ? 'OR' : 'or';
          separator.className = `wh-separator${hasResults ? ' wh-separator-bold' : ''}`.trim();
          partWrapper.appendChild(separator);
        }
        partWrapper.appendChild(stepLabel);
        previewLine.appendChild(partWrapper);
      } else {
        if (showSeparator) {
          previewLine.appendChild(document.createElement('wbr'));
          const separator = document.createElement('span');
          separator.textContent = hasResults ? 'OR' : 'or';
          separator.className = `wh-separator${hasResults ? ' wh-separator-bold' : ''}`.trim();
          previewLine.appendChild(separator);
          previewLine.appendChild(document.createElement('wbr'));
        }
        previewLine.appendChild(stepLabel);
      }
    });

    return previewLine;
  }

  function createStepPreviewLines(buttonText, optionObject, encounter) {
    const lines = [createStepHeaderLine(buttonText, optionObject, encounter, false)];
    const queue = [...(Array.isArray(optionObject.steps) ? optionObject.steps : [])];
    const visitedSteps = new Set();
    const leafStepLines = [];

    while (queue.length > 0) {
      const stepName = queue.shift();
      if (!stepName || visitedSteps.has(stepName)) continue;

      const stepValue = encounter.data.steps?.[stepName];
      if (stepValue === undefined) continue;

      visitedSteps.add(stepName);

      if (isStepOption(stepValue)) {
        lines.push(createStepHeaderLine(stepName, stepValue, encounter, true));
        if (Array.isArray(stepValue.steps)) {
          queue.push(...stepValue.steps);
        }
      } else {
        const stepLine = createResultLine(stepName, parseResult(stepValue, encounter.data.location));
        stepLine.className = 'wh-line-step';
        leafStepLines.push(stepLine);
      }
    }

    lines.push(...leafStepLines);
    return lines;
  }

  function createResultLine(buttonText, outcomes) {
    const settings = getFormatting();
    const line = document.createElement('div');
    line.className = settings.spacing ? 'wh-line-default' : 'wh-line-normal';
    const labelBold = document.createElement('b');
    labelBold.textContent = buttonText + ': ';
    line.appendChild(labelBold);

    outcomes.forEach((outcome, index) => {
      if (!settings.grouped) {
        line.appendChild(createResultElement(outcome, index > 0));
      } else {
        const resultWrapper = document.createElement('span');
        resultWrapper.className = 'wh-wrapper-result';
        resultWrapper.appendChild(createResultElement(outcome, index > 0));
        line.appendChild(resultWrapper);
      }
    });
    return line;
  }

  function createCommaSeparatedLine(contentText, labelText = null) {
    const settings = getFormatting();
    const useImages = settings.images;
    const useGrouped = settings.grouped;
    const textSpace = useGrouped ? '\u00A0' : ' ';
    const normalSpace = ' ';
    const line = document.createElement('div');

    if (labelText !== null) {
      line.className = 'wh-line-normal';
      const labelBold = document.createElement('b');
      labelBold.textContent = labelText + ': ';
      line.appendChild(labelBold);
    }

    const parts = contentText.split(',');
    parts.forEach((part, partIndex) => {
      const trimmed = part.trim();
      if (!trimmed) return;

      const separators = trimmed.split('|');
      for (let segmentIndex = 0; segmentIndex < separators.length; segmentIndex += 2) {
        const textBefore = separators[segmentIndex] ? separators[segmentIndex].trim() : '';
        const imageKeys = useImages ? separators[segmentIndex + 1] : null;

        const textElements = [];
        if (textBefore) {
          const textToAppend = segmentIndex > 0 ? ' ' + textBefore : textBefore;
          const temporarySpan = document.createElement('span');
          appendFormattedText(temporarySpan, textToAppend);
          textElements.push(...temporarySpan.childNodes);
        }

        const imageElements = [];
        if (imageKeys) {
          const imageNames = imageKeys.split(';').map(rawImageKey => rawImageKey.trim().replace(/[^a-zA-Z0-9_-]/g, '')).filter(Boolean);
          imageNames.forEach((imageName, imageIndex) => {
            const image = createRewardImage(imageName, textBefore, imageIndex, true, false);
            if (image) imageElements.push(image);
          });
        }

        if (textElements.length > 0) line.append(...textElements);

        const isLastPart = (partIndex === parts.length - 1 && segmentIndex + 2 >= separators.length);

        if (imageElements.length > 0) {
          if (textElements.length > 0) line.appendChild(document.createTextNode(textSpace));
          const partWrapper = document.createElement('span');
          partWrapper.className = 'wh-wrapper-part';
          partWrapper.append(...imageElements);
          if (!isLastPart) partWrapper.append(document.createTextNode(','));
          line.appendChild(partWrapper);
          if (!isLastPart) line.appendChild(document.createTextNode(normalSpace));
        } else if (!isLastPart) {
          line.appendChild(document.createTextNode(',' + normalSpace));
        }
      }
    });
    return line;
  }

  const createTrophyLine = (labelText, dropString) => createCommaSeparatedLine(dropString, labelText);
  const createNoteLine = (noteText) => createCommaSeparatedLine(noteText, null);

  function createDetailLine(detailText) {
    const settings = getFormatting();
    const useImages = settings.images;
    const useGrouped = settings.grouped;
    const TEXT_SPACE = useGrouped ? '\u00A0' : ' ';
    const line = document.createElement('div');
    line.className = 'wh-line-detail';
    const parts = detailText.split('|');

    for (let imageIndex = 0; imageIndex < parts.length; imageIndex += 2) {
      const textBefore = parts[imageIndex] ? parts[imageIndex].trim() : '';
      const imageKeys = useImages ? parts[imageIndex + 1] : null;

      let textElements = [];
      if (textBefore) {
        let textToAppend = textBefore;
        if (imageIndex > 0 && parts[imageIndex - 1] && /^[a-zA-Z0-9]/.test(textBefore)) textToAppend = ' ' + textToAppend;
        const tempSpan = document.createElement('span');
        appendFormattedText(tempSpan, textToAppend);
        textElements.push(...tempSpan.childNodes);
      }

      let imageElements = [];
      if (imageKeys) {
        const imageNames = imageKeys.split(';').map(rawImageKey => rawImageKey.trim().replace(/[^a-zA-Z0-9_-]/g, '')).filter(Boolean);
        imageNames.forEach((imageName, imageIndex) => {
          const image = createRewardImage(imageName, textBefore, imageIndex, true, false);
          if (image) {
            imageElements.push(image);
          }
        });
      }

      if (textElements.length > 0) {
        line.append(...textElements);
      }

      if (imageElements.length > 0) {
        if (textElements.length > 0) {
          line.appendChild(document.createTextNode(TEXT_SPACE));
        }
        const partWrapper = document.createElement('span');
        partWrapper.className = 'wh-wrapper-part';
        partWrapper.append(...imageElements);
        line.appendChild(partWrapper);
      }
    }
    return line;
  }

  function createNotesElement(notes, conditional, details, location, buttons) {
    if (!notes && !conditional && !details && !location) return null;
    const noteList = Array.isArray(notes) ? [...notes] : notes ? [notes] : [];
    if (noteList.length === 0) return null;

    const container = document.createElement('div');
    container.className = 'wh-container';
    const labelBold = document.createElement('b');
    labelBold.textContent = 'Notes:';
    container.appendChild(labelBold);

    for (const note of noteList) {
      let noteText = String(note).trim();
      const conditionalMatch = noteText.match(/^(\*+)@conditional(\d+)(?:\[([^\]]+)\])?$/i);

      if (conditionalMatch) {
        const conditionalPrefix = conditionalMatch[1] || '';
        const conditionalIndex = Number(conditionalMatch[2]) - 1;
        const specifiedOption = conditionalMatch[3]?.trim() || null;
        const conditionalEntries = conditional ? Object.entries(conditional) : [];

        let matchingConditional = specifiedOption
          ? conditionalEntries.find(([optionName]) => matchOptionName(specifiedOption, optionName) && [...buttons].some(button => matchOptionName(button.textContent, optionName)))
          : conditionalEntries.find(([optionName]) => [...buttons].some(button => matchOptionName(button.textContent, optionName)));

        if (!matchingConditional) continue;
        const [, conditionalValue] = matchingConditional;
        const conditionalNotes = Array.isArray(conditionalValue) ? conditionalValue : [conditionalValue];
        const conditionalNote = conditionalNotes[conditionalIndex];
        if (conditionalNote === undefined) continue;

        let conditionalText = String(conditionalNote).trim();
        const conditionalDetailsMatch = conditionalText.match(/^(\*+)@details(\d+)$/i);
        const conditionalDetailsNoPrefixMatch = conditionalText.match(/^@details(\d+)$/i);

        if (conditionalDetailsMatch || conditionalDetailsNoPrefixMatch) {
          let detailPrefix = conditionalDetailsMatch ? conditionalDetailsMatch[1] || '' : '';
          let detailIndex = Number((conditionalDetailsMatch || conditionalDetailsNoPrefixMatch)[1]) - 1;

          if (details?.[detailIndex] !== undefined) {
            const detailText = conditionalPrefix + detailPrefix + resolveReferences(String(details[detailIndex]), location);
            container.appendChild(createDetailLine(detailText));
          }
          continue;
        }

        conditionalText = conditionalPrefix + resolveReferences(conditionalText, location);
        container.appendChild(createNoteLine(conditionalText));
        continue;
      }

      const detailsMatch = noteText.match(/^(\*+)@details(\d+)$/i);
      if (detailsMatch) {
        const detailPrefix = detailsMatch[1] || '';
        const detailIndex = Number(detailsMatch[2]) - 1;
        if (details?.[detailIndex] !== undefined) {
          const detailText = detailPrefix + resolveReferences(String(details[detailIndex]), location);
          container.appendChild(createDetailLine(detailText));
        }
        continue;
      }

      noteText = resolveReferences(noteText, location);
      container.appendChild(createNoteLine(noteText));
    }

    return container.children.length === 1 ? null : container;
  }

  function clearExploreHelper(fullReset = false) {
    if (fullReset) activeEncounterId = null;
    document.querySelectorAll('.explore-helper').forEach(helper => helper.remove());
  }

  function getOrCreateHelper(output) {
    let helper = output.querySelector('.explore-helper');
    if (!helper) {
      helper = document.createElement('div');
      helper.className = 'explore-helper';
    } else {
      helper.replaceChildren();
    }
    return helper;
  }

  function appendHelperToOutput(output, helper) {
    if (helper.parentNode) return;
    const energyMessage = [...output.querySelectorAll('p')].find(paragraph => /^\s*you lost\s+-\d+%\s+energy exploring\.?\s*$/i.test(paragraph.textContent.trim()));
    const essenceMessage = [...output.querySelectorAll('p')].find(paragraph => /^\s*-\d+\s+lunar essence\s*$/i.test(paragraph.textContent.trim()));

    if (energyMessage) energyMessage.before(helper);
    else if (essenceMessage) essenceMessage.before(helper);
    else output.appendChild(helper);
  }

  function updateExploreOutput() {
    const settings = getSettings();
    if (!settings.enabled) {
      clearExploreHelper(false);
      return;
    }

    const output = document.querySelector('#explore-output');
    if (!output || !encounterDatabase) return;

    const encounter = settings.encounters ? findCurrentEncounter(output) : null;
    const buttons = output.querySelectorAll('button');

    if (buttons.length === 0) {
      clearExploreHelper(false);
      return;
    }

    if (!encounter && settings.trophies) {
      const hasEnemyPrompt = /oh\s+no!/i.test(output.textContent);
      const enemyData = hasEnemyPrompt ? findEnemy(output) : null;
      if (enemyData) {
        console.log(`[Wolvhelper] Active Enemy ID: ${enemyData.id} | Name: ${enemyData.name}`);
        const helper = getOrCreateHelper(output);
        const enemyHeader = document.createElement('div');
        enemyHeader.className = 'wh-header-enemy';
        const enemyHeaderText = document.createElement('b');
        enemyHeaderText.textContent = `${enemyData.name} Trophies`;
        enemyHeader.appendChild(enemyHeaderText);
        helper.appendChild(enemyHeader);

        if (enemyData.drops?.items) helper.appendChild(createTrophyLine('Items', enemyData.drops.items));
        if (enemyData.drops?.recipes) helper.appendChild(createTrophyLine('Recipes', enemyData.drops.recipes));

        appendHelperToOutput(output, helper);
        return;
      }
    }

    if (!settings.encounters || !encounter || buttons.length === 0) {
      clearExploreHelper(false);
      return;
    }

    const encounterId = encounter.matchId || encounter.subId || encounter.id;
    const encounterName = Array.isArray(encounter.data.name)
      ? (encounter.data.name[encounter.index] !== undefined ? encounter.data.name[encounter.index] : encounter.data.name[0])
      : (encounter.data.name || 'Unknown');

    console.log(`[Wolvhelper] Active Encounter ID: ${encounterId} | Name: ${encounterName}`);

    const resultLines = [];
    for (const button of buttons) {
      const buttonText = button.textContent.trim();
      const cleanButton = buttonText.replace(/\s*\[.*?\]|\s*\(.*?\)/g, '').trim();

      if (buttonText === cleanButton) {
        console.log('[Wolvhelper] Option Found:', buttonText);
      } else {
        console.log('[Wolvhelper] Option Found:', buttonText, '| Cleaned:', cleanButton);
      }

      let matchedName = null;
      let matchedValue = null;
      let matchedOption = null;

      for (const [optionName, optionValue] of Object.entries(encounter.data.options || {})) {
        const score = matchScore(buttonText, optionName);
        if (!score) continue;
        const isSeasonal = /\s*\[(spring|summer|autumn|winter)\]$/i.test(optionName);
        const candidate = { name: optionName, value: optionValue, isSeasonal, score };

        if (!matchedOption || score > matchedOption.score || (score === matchedOption.score && isSeasonal && !matchedOption.isSeasonal)) {
          matchedOption = candidate;
        }
      }

      if (matchedOption) {
        matchedName = matchedOption.name;
        matchedValue = matchedOption.value;
      }

      if (matchedName === null && encounter.data.steps) {
        for (const stepName of Object.keys(encounter.data.steps)) {
          if (normalizeText(cleanButton) === normalizeText(stepName)) {
            matchedName = stepName;
            matchedValue = encounter.data.steps[stepName];
            break;
          }
        }
      }

      if (matchedName === null) continue;

      const cleanOptionLabel = matchedName.replace(/\s*\[(spring|summer|autumn|winter)\]$/i, '');

      if (isStepOption(matchedValue)) {
        resultLines.push(...createStepPreviewLines(cleanOptionLabel, matchedValue, encounter));
        continue;
      }

      resultLines.push(createResultLine(cleanOptionLabel, parseResult(matchedValue, encounter.data.location)));
    }

    const notes = (settings.encounters && settings.notes) ? createNotesElement(encounter.data.notes, encounter.data.conditional, encounter.data.details, encounter.data.location, buttons) : null;
    const encounterTrophies = settings.trophies ? createTrophiesElement(encounter, buttons, enemyDatabase, output) : null;

    if (!resultLines.length && !notes && !encounterTrophies) {
      clearExploreHelper();
      return;
    }

    const helper = getOrCreateHelper(output);
    const elementsToAppend = [...resultLines, encounterTrophies, notes].filter(Boolean);
    helper.append(...elementsToAppend);
    appendHelperToOutput(output, helper);
  }

  function getOutputSignature(output) {
    const buttons = [...output.querySelectorAll('button')].map(button => button.dataset.action || button.textContent.trim()).join('|');
    const background = document.querySelector('#explore-foreground')?.style.backgroundImage || '';
    const paragraphText = [...output.querySelectorAll('p')].map(paragraph => paragraph.textContent.trim()).join('|');
    return `${buttons}::${background}::${paragraphText}`;
  }

  function checkExploreOutput() {
    const settings = getSettings();
    if (!settings.enabled) return;

    const output = document.querySelector('#explore-output');
    if (!output) {
      if (activeEncounterId !== null) {
        activeEncounterId = null;
        clearExploreHelper(true);
      }
      lastSignature = '';
      return;
    }

    if (!encounterDatabase) {
      ensureDatabase();
      return;
    }

    const currentSignature = getOutputSignature(output);
    if (currentSignature !== lastSignature) {
      lastSignature = currentSignature;
      updateExploreOutput();
    }
  }

  function handleExploreInteraction(event) {
    if (event.button !== 0) return;
    const triggerElement = event.target.closest('#explore-explore-link, #explore-output button');
    if (!triggerElement) return;
    const output = document.querySelector('#explore-output');
    if (output) {
      const isExplorePawLink = triggerElement.matches('#explore-explore-link');
      clearExploreHelper(isExplorePawLink);
      lastSignature = getOutputSignature(output);
    }
  }

  document.addEventListener('click', handleExploreInteraction, true);

  function initializeScript() {
    injectStyles();
    injectPanel();
    checkExploreOutput();
  }

  initializeScript();

  const bootstrapObserver = new MutationObserver(() => {
    injectStyles();

    if (isPending) return;
    isPending = true;
    requestAnimationFrame(() => {
      injectPanel();
      checkExploreOutput();
      isPending = false;
    });
  });

  if (document.documentElement) {
    bootstrapObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', initializeScript);
  window.addEventListener('load', initializeScript);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) initializeScript();
  });

  setTimeout(initializeScript, 100);

})();