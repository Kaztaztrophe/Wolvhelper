// ==UserScript==
// @name        WolvhelperMini: Explore Encounters
// @namespace   https://github.com/Kaztaztrophe/Wolvhelper
// @version     1.6.3
// @author      Kaztaztrophe
// @description Wolvden explore encounter helper which displays results
// @match       https://www.wolvden.com/*
// @match       https://wolvden.com/*
// @run-at      document-idle
// @grant       none
// @noframes
// @updateURL   https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/wolvhelpermini_encounters.user.js
// @downloadURL https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/wolvhelpermini_encounters.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CACHE_KEY = 'wolvhelpermini_cache'; // WolvhelperMini version ONLY
  const CACHE_SCHEMA = 3; // Bumped when shape of JSON files change
  const UPDATE_COOLDOWN = 10 * 60 * 1000; // 10 minutes
  const FETCH_TIMEOUT = 10 * 1000; // 10 seconds

  const URL_ENCOUNTERS = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/encounters.json';
  const URL_POOLS = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/pools.json';
  const URL_TROPHIES = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/trophies.json';

  const TEXT_SPACE = ' '; // WolvhelperMini version ONLY

  // WolvhelperMini version ONLY
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .explore-helper { overflow: hidden; margin: 10px 0; }
      .wh-container { margin-top: 8px; text-align: left; }
      .wh-header-enemy { margin-bottom: 4px; text-align: left; }
      .wh-line-normal { text-align: left; }
      .wh-line-step { margin-left: 16px; text-align: left; }
      .wh-separator { margin-left: 4px; margin-right: 4px; }
    `;
    document.head.appendChild(style);
  }

  let encounterDatabase = null;
  let encounterIdLookup = [];
  let enemyDatabase = null;
  let enemyIdLookup = [];
  let activeEncounterId = null;
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
      // WolvhelperMini version ONLY
      const [encountersResult, poolsResult, trophiesResult] = await Promise.allSettled([
        fetchData(URL_ENCOUNTERS), fetchData(URL_POOLS), fetchData(URL_TROPHIES)
      ]);

      const useResult = (result, fallback, name) => {
        if (result.status === 'fulfilled') return result.value;
        console.warn(`[Wolvhelper] Could not update ${name}:`, result.reason);
        return fallback;
      };

      const newEncounterData = useResult(encountersResult, encounterDatabase && { encounters: encounterDatabase.encounters }, 'encounters.json');
      if (!newEncounterData) throw new Error('[Wolvhelper] Could not download encounters.json');
      newEncounterData.pools = useResult(poolsResult, encounterDatabase?.pools, 'pools.json') || {};
      const newEnemyData = useResult(trophiesResult, enemyDatabase, 'trophies.json');

      if (!newEncounterData.encounters || typeof newEncounterData.encounters !== 'object') {
        throw new Error('[Wolvhelper] Downloaded database is missing "encounters"');
      }
      if (!newEnemyData?.trophies || typeof newEnemyData.trophies !== 'object') {
        throw new Error('[Wolvhelper] Downloaded database is missing "trophies"');
      }

      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          schema: CACHE_SCHEMA,
          timestamp: Date.now(),
          encounterDatabase: newEncounterData,
          enemyDatabase: newEnemyData
        }));
      } catch (error) {
        console.warn('[Wolvhelper] Could not write cache.', error);
      }

      encounterDatabase = newEncounterData;
      enemyDatabase = newEnemyData;

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
      const multiIds = key.split('|').map(s => s.trim());

      let prompts = [];
      if (Array.isArray(data?.prompt)) {
        prompts = data.prompt.map(normalizeText);
      } else if (typeof data?.prompt === 'string' && data.prompt.trim()) {
        prompts = data.prompt.split('|').map(normalizeText);
      }

      for (const multiId of multiIds) {
        encounterIdLookup.push({
          id: key,
          normalized: normalizeText(multiId),
          prompts: prompts
        });
      }
    }

    encounterIdLookup.sort((a, b) => b.normalized.length - a.normalized.length);

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
    return optionValue && typeof optionValue === 'object' && !Array.isArray(optionValue) && Array.isArray(optionValue.steps);
  }

  function getCurrentSeason() {
    const seasonIcon = document.querySelector('img.seasonIcon[data-original-title], img.seasonIcon[title]');
    if (!seasonIcon) return null;
    const season = seasonIcon.getAttribute('data-original-title') || seasonIcon.getAttribute('title');
    return season ? season.trim().toLowerCase() : null;
  }

  function matchScore(buttonText, optionName) {
    const cleanButton = buttonText.replace(/\s*\[.*?\]|\s*\(.*?\)/g, '').trim();
    
    const seasonalMatch = optionName.match(/\s*\[(spring|summer|autumn|winter)\]$/i);
    if (seasonalMatch) {
      const optionSeason = seasonalMatch[1].toLowerCase();
      const currentSeason = getCurrentSeason();
      if (!currentSeason || currentSeason !== optionSeason) return 0;
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
    let previousText;
    let maxDepth = 10;

    do {
      previousText = text;
      text = text.replace(/(\**)\@([a-zA-Z0-9_]+)/g, (match, prefix, key) => {
        const locationMatch = key.match(/^location(\d+)$/);
        if (locationMatch) {
          const index = Number(locationMatch[1]) - 1;
          return locationValues[index] !== undefined ? prefix + locationValues[index] : match;
        }
        if (encounterDatabase.pools?.[key]) return prefix + encounterDatabase.pools[key];
        if (encounterDatabase.notes?.[key]) return prefix + encounterDatabase.notes[key];
        return match;
      });
      maxDepth--;
    } while (text !== previousText && maxDepth > 0);

    return text;
  }

  function findEncounterByImage() {
    const foreground = document.querySelector('#explore-foreground');
    const backgroundImage = foreground?.style.backgroundImage;
    if (!backgroundImage) return null;

    const match = backgroundImage.match(/\/([^\/?#]+)\.(?:png|jpg|jpeg|webp)(?:[?#][^"')]*)?["')]*$/i);
    if (!match) return null;

    let filename = match[1].toLowerCase().replace(/[_-]/g, '');
    filename = filename.replace(/(?:spring|summer|autumn|winter)?(?:day|dawn|dusk|night)$|(?:spring|summer|autumn|winter)$/i, '');

    const entry = encounterIdLookup.find(encounter => filename === encounter.normalized) || encounterIdLookup.find(encounter => encounter.normalized.length >= 5 && filename.includes(encounter.normalized));
    return entry ? { id: entry.id, data: encounterDatabase.encounters[entry.id] } : null;
  }

  function findEncounterIdFromAction(action) {
    if (!action || encounterIdLookup.length === 0) {
      return null;
    }

    const rawAction = action.toLowerCase();
    const actionTokens = rawAction.split(/[^a-z0-9]+/);

    for (const entry of encounterIdLookup) {
      if (actionTokens.includes(entry.normalized)) {
        return entry.id;
      }

      if (entry.normalized.startsWith('filler')) {
        const fillerSuffix = entry.normalized.slice(6);
        if (actionTokens.includes('filler_' + fillerSuffix) || (actionTokens.includes('filler') && actionTokens.includes(fillerSuffix))) {
          return entry.id;
        }
      }
    }

    return null;
  }

  function findEncounterByButton(output) {
    const buttons = output.querySelectorAll('button');

    for (const button of buttons) {
      const action = button.dataset.action;
      const id = findEncounterIdFromAction(action);

      if (id && encounterDatabase.encounters[id]) {
        return {
          id: id,
          data: encounterDatabase.encounters[id]
        };
      }
    }

    return null;
  }

  function findEncounterByPrompt(output) {
    const normalizedParagraphs = Array.from(output.querySelectorAll('p'))
      .map(paragraph => normalizeText(paragraph.textContent));

    for (const entry of encounterIdLookup) {
      if (!entry.prompts || entry.prompts.length === 0) continue;

      const matched = entry.prompts.some(target => 
        target && normalizedParagraphs.some(paragraphText => paragraphText.includes(target))
      );

      if (matched) {
        return { id: entry.id, data: encounterDatabase.encounters[entry.id] };
      }
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
    const newResult = findEncounterByImage(output) || findEncounterByButton(output) || findEncounterByPrompt(output);

    if (newResult) {
      if (activeEncounterId !== newResult.id) {
        activeEncounterId = newResult.id;
      }
      return newResult;
    }

    if (activeEncounterId && encounterDatabase.encounters[activeEncounterId]) {
      const current = { id: activeEncounterId, data: encounterDatabase.encounters[activeEncounterId] };
      if (encounterMatchesButtons(current, output)) return current;
    }

    activeEncounterId = null;
    return null;
  }

  function findEnemy(output) {
    if (!enemyDatabase || !enemyIdLookup.length) return null;

    const foreground = output.querySelector('#explore-foreground');

    if (foreground && foreground.style.backgroundImage) {
      const background = foreground.style.backgroundImage;
      const match = background.match(/\/enemies\/([^\/?#]+)\.(?:png|jpg|jpeg|webp)/i);

      if (match) {
        let rawFilename = match[1].toLowerCase();
        let filename = rawFilename.replace(/[_-]/g, '');
        filename = filename.replace(/(?:spring|summer|autumn|winter)?(?:day|dawn|dusk|night)$|(?:spring|summer|autumn|winter)$/i, '');

        const isCorrupted = /corrupt/i.test(filename);

        for (const entry of enemyIdLookup) {
          if (filename.includes(entry.normalized)) {
            const trophy = enemyDatabase.trophies[entry.id];
            if (!trophy) continue;

            if (isCorrupted && !trophy.name?.toLowerCase().startsWith('corrupted')) {
              return { ...trophy, name: `Corrupted ${trophy.name}` };
            }
            return trophy;
          }
        }
      }
    }

    const paragraphsText = Array.from(output.querySelectorAll('p')).map(paragraph => paragraph.textContent);
    const enemyParagraph = paragraphsText.find(text => /oh\s+no!/i.test(text));

    if (enemyParagraph) {
      const normalizedContent = normalizeText(enemyParagraph);
      const isCorrupted = /corrupt/i.test(enemyParagraph);

      for (const entry of enemyIdLookup) {
        const trophyObject = enemyDatabase.trophies[entry.id];
        const normalizedName = entry.normalizedName;

        if (normalizedContent.includes(entry.normalized) || (normalizedName && normalizedContent.includes(normalizedName))) {
          if (!trophyObject) continue;

          if (isCorrupted && !trophyObject.name?.toLowerCase().startsWith('corrupted')) {
            return { ...trophyObject, name: `Corrupted ${trophyObject.name}` };
          }
          return trophyObject;
        }
      }
    }

    return null;
  }

  function appendFormattedText(container, text) {
    let lastIndex = 0;
    const elementsToAppend = [];

    for (const match of text.matchAll(/'''([^']+)'''|''([^']+)''/g)) {
      if (match.index > lastIndex) {
        elementsToAppend.push(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      if (match[1] !== undefined) {
        // Bold: '''text'''
        const bold = document.createElement('b');
        bold.textContent = match[1];
        elementsToAppend.push(bold);
      } else if (match[2] !== undefined) {
        // Italic: ''text''
        const italic = document.createElement('i');
        italic.textContent = match[2];
        elementsToAppend.push(italic);
      }
      lastIndex = match.index + match[0].length; 
    }

    if (lastIndex < text.length) {
      elementsToAppend.push(document.createTextNode(text.slice(lastIndex)));
    }

    container.append(...elementsToAppend);
  }

  function parseSingleReward(value, location) {
    let resolvedValue = resolveLevelExpressions(value);
    resolvedValue = resolveReferences(resolvedValue, location);

    const parts = resolvedValue.split('|');
    const segments = [];
    for (let i = 0; i < parts.length; i += 2) {
      segments.push({
        text: parts[i] ? parts[i].trim() : ''
      });
    }

    return { segments };
  }

  function parseCompoundResult(value, location) {
    return value.split('//').reduce((accumulator, part) => {
      const trimmed = part.trim();
      if (trimmed) {
        accumulator.push(parseSingleReward(trimmed, location));
      }
      return accumulator;
    }, []);
  }

  function parseResult(value, location) {
    return Array.isArray(value) ? value.map(outcome => parseCompoundResult(outcome, location)) : [parseCompoundResult(value, location)];
  }

  function createResultElement(rewards) {
    const container = document.createElement('span');
    const elementsToAppend = [];

    rewards.forEach((reward, index) => {
      if (index > 0) elementsToAppend.push(document.createTextNode(' & '));

      reward.segments.forEach((segment, segIndex) => {
        const resultText = segment.text;

        if (resultText) {
          let textToAppend = resultText;
          if (segIndex > 0 && !/^[*,.;!?]/.test(resultText)) {
            textToAppend = ' ' + textToAppend;
          }

          const noResultRegex = /No result(\**)/gi;
          let lastIndex = 0;
          let match;

          while ((match = noResultRegex.exec(textToAppend)) !== null) {
            if (match.index > lastIndex) elementsToAppend.push(document.createTextNode(textToAppend.slice(lastIndex, match.index)));

            const noResult = document.createElement('i');
            noResult.textContent = 'No result';
            elementsToAppend.push(noResult);

            if (match[1]) elementsToAppend.push(document.createTextNode(match[1]));
            lastIndex = noResultRegex.lastIndex;
          }

          if (lastIndex < textToAppend.length) elementsToAppend.push(document.createTextNode(textToAppend.slice(lastIndex)));
        }
      });
    });

    container.append(...elementsToAppend);
    return container;
  }

  function createStepPreviewLines(buttonText, steps, encounter) {
    const lines = [];
    const previewLine = document.createElement('div');
    previewLine.className = 'wh-line-normal';

    const label = document.createElement('b');
    label.textContent = buttonText + ': ';
    previewLine.appendChild(label);

    steps.forEach((step, index) => {
      if (index > 0) {
        const separator = document.createElement('span');
        separator.textContent = 'or';
        separator.className = 'wh-separator';
        previewLine.appendChild(separator);
      }
      const stepLabel = document.createElement('b');
      stepLabel.textContent = step;
      previewLine.appendChild(stepLabel);
    });

    lines.push(previewLine);

    steps.forEach(stepName => {
      const stepValue = encounter.data.steps?.[stepName];
      if (stepValue === undefined) return;

      const stepLine = createResultLine(stepName, parseResult(stepValue, encounter.data.location));
      stepLine.className = 'wh-line-step';
      lines.push(stepLine);
    });

    return lines;
  }

  function createResultLine(buttonText, outcomes) {
    const line = document.createElement('div');
    line.className = 'wh-line-normal';

    const label = document.createElement('b');
    label.textContent = buttonText + ': ';
    line.appendChild(label);

    outcomes.forEach((outcome, index) => {
      const resultWrapper = document.createElement('span');

      if (index > 0) {
        const separator = document.createElement('span');
        separator.textContent = 'OR';
        separator.className = 'wh-separator';
        separator.style.fontWeight = 'bold';

        resultWrapper.appendChild(separator);
      }
      resultWrapper.appendChild(createResultElement(outcome));
      line.appendChild(resultWrapper);
    });

    return line;
  }

  function createTrophyLine(labelText, dropString) {
    const line = document.createElement('div');
    line.className = 'wh-line-normal';

    const labelBold = document.createElement('b');
    labelBold.textContent = labelText + ': ';

    const partsToAppend = [labelBold];

    const parts = dropString.split(',');
    parts.forEach((part, i) => {
      const trimmed = part.trim();
      if (!trimmed) return;

      const partWrapper = document.createElement('span');
      const wrapperElements = [];

      const separators = trimmed.split('|');
      for (let j = 0; j < separators.length; j += 2) {
        const textBefore = separators[j] ? separators[j].trim() : '';

        if (textBefore) {
          let textToAppend = textBefore;
          if (j > 0 && !/^[*,.;!?]/.test(textBefore)) {
            textToAppend = ' ' + textBefore;
          }
          const tempSpan = document.createElement('span');
          appendFormattedText(tempSpan, textToAppend);
          wrapperElements.push(...tempSpan.childNodes);
        }
      }

      if (i < parts.length - 1) wrapperElements.push(document.createTextNode(',' + TEXT_SPACE)); // WolvhelperMini version ONLY

      partWrapper.append(...wrapperElements);
      partsToAppend.push(partWrapper);
    });

    line.append(...partsToAppend);
    return line;
  }

  function createTrophiesElement(encounter, buttons, enemyDatabase) {
    if (!encounter || !encounter.data || !encounter.data.trophies) return null;

    let activeTrophyId = null;

    if (typeof encounter.data.trophies === 'string') {
      const isFirstStep = [...buttons].some(button => Object.keys(encounter.data.options || {}).some(optionName => matchOptionName(button.textContent.trim(), optionName)));

      if (isFirstStep || !encounter.data.options) {
        activeTrophyId = encounter.data.trophies;
      }
    } else if (typeof encounter.data.trophies === 'object') {
      for (const [stepName, trophyId] of Object.entries(encounter.data.trophies)) {
        const isMatch = [...buttons].some(button => matchOptionName(button.textContent.trim(), stepName)
        );

        if (isMatch) {
          activeTrophyId = trophyId;
          break;
        }
      }
    }

    if (!activeTrophyId) return null;

    const rawId = String(activeTrophyId);
    const trophyId = (rawId.startsWith('@') ? rawId.slice(1) : rawId).toLowerCase();
    const trophyData = enemyDatabase?.trophies?.[trophyId];

    if (!trophyData) return null;

    const encounterTrophies = document.createElement('div');
    encounterTrophies.className = 'wh-container';

    const trophyHeader = document.createElement('div');
    trophyHeader.className = 'wh-header-enemy';

    const trophyHeaderText = document.createElement('b');
    trophyHeaderText.textContent = `${trophyData.name || trophyId} Trophies`;
    trophyHeader.append(trophyHeaderText);

    const itemsLine = trophyData.drops?.items ? createTrophyLine('Items', trophyData.drops.items) : null;
    const recipesLine = trophyData.drops?.recipes ? createTrophyLine('Recipes', trophyData.drops.recipes) : null;

    encounterTrophies.append(...[trophyHeader, itemsLine, recipesLine].filter(Boolean));

    return encounterTrophies;
  }

  function createNoteLine(noteText) {
    const line = document.createElement('div');
    const parts = noteText.split(',');

    const partsToAppend = [];

    parts.forEach((part, i) => {
      const trimmed = part.trim();
      if (!trimmed) return;

      const partWrapper = document.createElement('span');
      const wrapperElements = [];

      const separators = trimmed.split('|');
      for (let j = 0; j < separators.length; j += 2) {
        const textBefore = separators[j] ? separators[j].trim() : '';

        if (textBefore) {
          let textToAppend = textBefore;
          if (j > 0 && !/^[*,.;!?]/.test(textBefore)) {
            textToAppend = ' ' + textBefore;
          }
          const tempSpan = document.createElement('span');
          appendFormattedText(tempSpan, textToAppend);
          wrapperElements.push(...tempSpan.childNodes);
        }
      }

      if (i < parts.length - 1) wrapperElements.push(document.createTextNode(',' + TEXT_SPACE)); // WolvhelperMini version ONLY

      partWrapper.append(...wrapperElements);
      partsToAppend.push(partWrapper);
    });

    line.append(...partsToAppend);
    return line;
  }

  function createDetailLine(detailText) {
    const line = document.createElement('div');

    const parts = detailText.split('|');

    for (let i = 0; i < parts.length; i += 2) {
      const textBefore = parts[i];

      if (textBefore) {
        let textToAppend = textBefore;
        if (i > 0 && parts[i - 1] && /^[a-zA-Z0-9]/.test(textBefore)) {
          textToAppend = ' ' + textBefore;
        }
        appendFormattedText(line, textToAppend);
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

    const label = document.createElement('b');
    label.textContent = 'Notes:';
    container.appendChild(label);

    for (const note of noteList) {
      let noteText = String(note).trim();
      const conditionalMatch = noteText.match(/^(\*+)@conditional(\d+)(?:\[([^\]]+)\])?$/i);

      if (conditionalMatch) {
        const conditionalPrefix = conditionalMatch[1] || '';
        const conditionalIndex = Number(conditionalMatch[2]) - 1;
        const specifiedOption = conditionalMatch[3]?.trim() || null;
        const conditionalEntries = conditional ? Object.entries(conditional) : [];

        let matchingConditional = null;
        if (specifiedOption) {
          matchingConditional = conditionalEntries.find(([buttonName]) => {
            return matchOptionName(buttonName, specifiedOption) && [...buttons].some(button => matchOptionName(button.textContent, specifiedOption));
          });
        } else {
          matchingConditional = conditionalEntries.find(([buttonName]) => {
            return [...buttons].some(button => matchOptionName(button.textContent, buttonName));
          });
        }

        if (!matchingConditional) continue;

        const [, conditionalValue] = matchingConditional;
        const conditionalNotes = Array.isArray(conditionalValue) ? conditionalValue : [conditionalValue];
        const conditionalNote = conditionalNotes[conditionalIndex];

        if (conditionalNote === undefined) continue;

        let conditionalText = String(conditionalNote).trim();
        const conditionalDetailsMatch = conditionalText.match(/^(\*+)@details(\d+)$/i);
        const conditionalDetailsNoPrefixMatch = conditionalText.match(/^@details(\d+)$/i);

        if (conditionalDetailsMatch || conditionalDetailsNoPrefixMatch) {
          let detailPrefix = '';
          let detailIndex;

          if (conditionalDetailsMatch) {
            detailPrefix = conditionalDetailsMatch[1] || '';
            detailIndex = Number(conditionalDetailsMatch[2]) - 1;
          } else {
            detailIndex = Number(conditionalDetailsNoPrefixMatch[1]) - 1;
          }

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

    if (energyMessage) {
      energyMessage.before(helper);
    } else if (essenceMessage) {
      essenceMessage.before(helper);
    } else {
      output.appendChild(helper);
    }
  }

  function updateExploreOutput() {
    const output = document.querySelector('#explore-output');
    if (!output || !encounterDatabase) return;

    const encounter = findCurrentEncounter(output);
    const buttons = output.querySelectorAll('button');
    if (!encounter || buttons.length === 0) {
      clearExploreHelper(false);
      return;
    }

    const enemyData = findEnemy(output);
    if (enemyData) {
      const helper = getOrCreateHelper(output);
      const enemyHeader = document.createElement('div');
      enemyHeader.className = 'wh-header-enemy';

      const enemyHeaderText = document.createElement('b');
      const displayName = enemyData.name || enemyData;

      enemyHeaderText.textContent = `${displayName} Trophies`;
      enemyHeader.appendChild(enemyHeaderText);
      helper.appendChild(enemyHeader);

      if (enemyData.drops?.items) helper.appendChild(createTrophyLine('Items', enemyData.drops.items));
      if (enemyData.drops?.recipes) helper.appendChild(createTrophyLine('Recipes', enemyData.drops.recipes));

      appendHelperToOutput(output, helper);
      return;
    }

    const resultLines = [];
    for (const button of buttons) {
      const buttonText = button.textContent.trim();
      const cleanButton = buttonText.replace(/\s*\[.*?\]|\s*\(.*?\)/g, '').trim();
      let matchedName = null;
      let matchedValue = null;
      let matchedOption = null;

      for (const [optionName, optionValue] of Object.entries(encounter.data.options || {})) {
        const score = matchScore(buttonText, optionName);
        if (!score) continue;

        const isSeasonal = /\s*\[(spring|summer|autumn|winter)\]$/i.test(optionName);
        const candidate = { name: optionName, value: optionValue, isSeasonal, score };

        if (!matchedOption || score > matchedOption.score ||
            (score === matchedOption.score && isSeasonal && !matchedOption.isSeasonal)) {
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

      if (isStepOption(matchedValue)) {
        resultLines.push(...createStepPreviewLines(buttonText, matchedValue.steps, encounter));
        continue;
      }

      resultLines.push(
        createResultLine(
          matchedName.replace(/\s*\[(spring|summer|autumn|winter)\]$/i, ''),
          parseResult(matchedValue, encounter.data.location)
        )
      );
    }

    const notes = createNotesElement(encounter.data.notes, encounter.data.conditional, encounter.data.details, encounter.data.location, buttons);

    const encounterTrophies = createTrophiesElement(encounter, buttons, enemyDatabase);

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
    const background = output.querySelector('#explore-foreground')?.style.backgroundImage || '';
    const paragraphCount = output.querySelectorAll('p').length;
    return `${buttons}::${background}::${paragraphCount}`;
  }

  function checkExploreOutput() {
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

  const observer = new MutationObserver(() => {
    if (isPending) return;
    isPending = true;

    requestAnimationFrame(() => {
      checkExploreOutput();
      isPending = false;
    });
  });

  function startObserving() {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('click', function (event) {
    const exploreLink = event.target.closest('#explore-explore-link');
    if (exploreLink) {
      clearExploreHelper(true);
      lastSignature = '';
    }
  });

  injectStyles();
  startObserving();
  checkExploreOutput();
})();