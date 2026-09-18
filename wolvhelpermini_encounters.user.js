// ==UserScript==
// @name        Wolvhelper: Explore Encounters (Mini)
// @namespace   https://github.com/Kaztaztrophe/Wolvhelper
// @version     1.5.8
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

	const ENCOUNTERS_URL = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/encounters.json';
	const POOLS_URL = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/pools.json';
	const HELPER_CLASS = 'explore-helper';
	const HELPER_MARGINS = '10px';
	const WAIT_TIMEOUT = 7500;

	let encounterDatabase = null;
	let encounterIdLookup = [];

	async function loadDatabase() {
		try {
			const [encountersResponse, poolsResponse] = await Promise.all([
				fetch(ENCOUNTERS_URL),
				fetch(POOLS_URL)
			]);

			if (!encountersResponse.ok) {
				throw new Error('[Wolvhelper] Failed to load encounters.json');
			}
			if (!poolsResponse.ok) {
				throw new Error('[Wolvhelper] Failed to load pools.json');
			}

			encounterDatabase = await encountersResponse.json();
			encounterDatabase.pools = await poolsResponse.json();

			if (!encounterDatabase.encounters || typeof encounterDatabase.encounters !== 'object') {
				throw new Error('[Wolvhelper] Database is missing "encounters"');
			}
			if (!encounterDatabase.pools || typeof encounterDatabase.pools !== 'object') {
				throw new Error('[Wolvhelper] Pools database is invalid');
			}

			encounterIdLookup = Object.keys(encounterDatabase.encounters)
				.map(id => ({
					id: id,
					normalized: id.toLowerCase()
				}))
				.sort((a, b) => b.normalized.length - a.normalized.length);

			updateExploreOutput();

		} catch (error) {
			console.error('[Wolvhelper] Failed to load database:', error);
		}
	}

	function normalizeText(text) {
		return text
			.toLowerCase()
			.replace(/\*/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/[!?.,:]+$/, '');
	}

	function isStepOption(optionValue) {
		return (optionValue && typeof optionValue === 'object' && !Array.isArray(optionValue) && Array.isArray(optionValue.steps));
	}

	function getCurrentSeason() {
		const seasonIcon = document.querySelector('img.seasonIcon[data-original-title], img.seasonIcon[title]');

		if (!seasonIcon) {
			return null;
		}

		const season = seasonIcon.getAttribute('data-original-title') || seasonIcon.getAttribute('title');

		if (!season) {
			return null;
		}

		return season.trim().toLowerCase();
	}

	function matchOptionName(buttonText, optionName) {
		const seasonalMatch = optionName.match(/\s*\[(spring|summer|autumn|winter)\]$/i);

		if (seasonalMatch) {
			const optionSeason = seasonalMatch[1].toLowerCase();
			const currentSeason = getCurrentSeason();

			if (!currentSeason || currentSeason !== optionSeason) {
				return false;
			}

			optionName = optionName
				.slice(0, seasonalMatch.index)
				.trim();
		}

		const normalizedButton = normalizeText(buttonText);
		const normalizedOption = normalizeText(optionName);

		return (normalizedButton === normalizedOption || normalizedButton.startsWith(normalizedOption + ' '));
	}

	function getPlayerLevel() {
		const levelElement = [...document.querySelectorAll('.card-body b')]
			.find(element => element.parentElement?.textContent.includes('Level'));

		if (!levelElement) {
			return null;
		}

		const level = Number(levelElement.textContent.trim());

		return Number.isFinite(level) ? level : null;
	}

	function resolveLevelExpressions(text) {
		const level = getPlayerLevel();

		if (level === null) {
			return text;
		}

		return text.replace(/\(LVL\s*([+*])\s*(\d+)\)/gi, (match, operator, number) => {
			const value = Number(number);

			if (operator === '+') {
				return String(level + value);
			}

			if (operator === '*') {
				return String(level * value);
			}

			return match;
		});
	}

	function getLocationValues(location) {
		if (!location || typeof location !== 'object') {
			return [];
		}

		const currentPath = window.location.pathname.replace(/\/+$/, '');

		for (const [locationPaths, value] of Object.entries(location)) {
			const paths = locationPaths
				.split('|')
				.map(path => path.trim().replace(/\/+$/, ''));

			for (const normalizedLocationPath of paths) {
				if (currentPath === normalizedLocationPath || currentPath.startsWith(normalizedLocationPath + '/')) {
					return Array.isArray(value) ? value : value ? [value] : [];
				}
			}
		}

		return [];
	}

	function resolveReferences(text, location) {
		const locationValues = getLocationValues(location);

		let previousText;

		do {
			previousText = text;

			text = text.replace(/(\**)\@([a-zA-Z0-9_]+)/g, (match, prefix, key) => {

					const locationMatch = key.match(/^location(\d+)$/);

					if (locationMatch) {
						const index = Number(locationMatch[1]) - 1;

						if (locationValues[index] !== undefined) {
							return prefix + locationValues[index];
						}

						return match;
					}

					if (encounterDatabase.pools?.[key]) {
						return prefix + encounterDatabase.pools[key];
					}

					if (encounterDatabase.notes?.[key]) {
						return prefix + encounterDatabase.notes[key];
					}

					return match;
				}
			);

		} while (text !== previousText);

		return text;
	}

	function findEncounterIdFromAction(action) {
		if (!action || encounterIdLookup.length === 0) {
			return null;
		}

		const normalizedAction = action.toLowerCase();

		for (const entry of encounterIdLookup) {

			if (normalizedAction.includes(entry.normalized)) {
				return entry.id;
			}

			if (entry.normalized.startsWith('filler')) {
				const fillerActionName = 'filler_' + entry.normalized.slice(6);

				if (normalizedAction.includes(fillerActionName)) {
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

	function findEncounterByImage(output) {
		const foreground = output.querySelector('#explore-foreground');

		if (!foreground) {
			return null;
		}

		const backgroundImage = foreground.style.backgroundImage;

		if (!backgroundImage) {
			return null;
		}

		const match = backgroundImage.match(/\/([^\/?#]+)\.(?:png|jpg|jpeg|webp)(?:[?#].*)?$/i);

		if (!match) {
			return null;
		}

		let filename = match[1].toLowerCase();

		filename = filename.replace(/[_-]/g, '');

		filename = filename.replace(/(?:spring|summer|autumn|winter)?(?:day|dawn|dusk|night)$|(?:spring|summer|autumn|winter)$/i, '');

		for (const entry of encounterIdLookup) {
			if (filename.includes(entry.normalized)) {
				return {
					id: entry.id,
					data: encounterDatabase.encounters[entry.id]
				};
			}
		}

		return null;
	}

	function findEncounterByIntro(output) {
		const paragraphs = output.querySelectorAll('p');

		for (const entry of encounterIdLookup) {
			const encounter = encounterDatabase.encounters[entry.id];

			if (!encounter.intro) {
				continue;
			}

			const target = normalizeText(encounter.intro);

			for (const paragraph of paragraphs) {
				if (normalizeText(paragraph.textContent).includes(target)) {
					return {
						id: entry.id,
						data: encounter
					};
				}
			}
		}

		return null;
	}

	function findCurrentEncounter(output) {
		const byButton = findEncounterByButton(output);

		if (byButton) {
			return byButton;
		}

		const byImage = findEncounterByImage(output);

		if (byImage) {
			return byImage;
		}

		return findEncounterByIntro(output);
	}

	function parseSingleReward(value, location) {
		let resolvedValue = resolveLevelExpressions(value);

		resolvedValue = resolveReferences(resolvedValue, location);

		const parts = resolvedValue.split('|');

		const result = parts[0].trim();

		const afterText = parts.slice(2).join('|').trim();

		return {
			result: result,
			afterText: afterText
		};
	}

	function parseCompoundResult(value, location) {
		return value
			.split('//')
			.map(part => part.trim())
			.filter(Boolean)
			.map(part => parseSingleReward(part, location));
	}

	function parseResult(value, location) {
		if (Array.isArray(value)) {
			return value.map(outcome => parseCompoundResult(outcome, location));
		}

		return [parseCompoundResult(value, location)];
	}

	function createResultElement(rewards) {
		const container = document.createElement('span');

		rewards.forEach((reward, index) => {
			if (index > 0) {
				container.appendChild(document.createTextNode(' & '));
			}

			const resultText = reward.result;
			const noRewardRegex = /No reward(\**)/gi;

			let lastIndex = 0;
			let match;

			while ((match = noRewardRegex.exec(resultText)) !== null) {

				if (match.index > lastIndex) {
					container.appendChild(document.createTextNode(resultText.slice(lastIndex, match.index)));
				}

				const noReward = document.createElement('i');
				noReward.textContent = 'No reward';
				container.appendChild(noReward);

				if (match[1]) {
					container.appendChild(document.createTextNode(match[1]));
				}

				lastIndex = noRewardRegex.lastIndex;
			}

			if (lastIndex < resultText.length) {
				container.appendChild(document.createTextNode(resultText.slice(lastIndex)));
			}

			if (reward.afterText) {
				container.appendChild(document.createTextNode(' ' + reward.afterText));
			}
		});

		return container;
	}

	function createStepPreviewLines(buttonText, steps, encounter) {
		const lines = [];

		const previewLine = document.createElement('div');
		previewLine.style.textAlign = 'left';

		const label = document.createElement('b');
		label.textContent = buttonText + ': ';

		previewLine.appendChild(label);

		steps.forEach((step, index) => {
			if (index > 0) {
				const separator = document.createElement('span');
				separator.textContent = 'or';
				separator.style.marginLeft = '4px';
				separator.style.marginRight = '4px';

				previewLine.appendChild(separator);
			}

			const stepLabel = document.createElement('b');
			stepLabel.textContent = step;

			previewLine.appendChild(stepLabel);
		});

		lines.push(previewLine);

		for (const stepName of steps) {
			const stepValue = encounter.data.steps?.[stepName];

			if (stepValue === undefined) {
				continue;
			}

			const stepLine = createResultLine(stepName, parseResult(stepValue, encounter.data.location));

			stepLine.style.marginLeft = '15px';

			lines.push(stepLine);
		}

		return lines;
	}

	function createStepResultLines(encounter, stepNames) {
		const resultLines = [];

		for (const stepName of stepNames) {
			const stepValue = encounter.data.steps?.[stepName];

			if (stepValue === undefined) {
				continue;
			}

			const outcomes = parseResult(stepValue, encounter.data.location);

			resultLines.push(createResultLine(stepName, outcomes));
		}

		return resultLines;
	}

	function createResultLine(buttonText, outcomes) {
		const line = document.createElement('div');
		line.style.textAlign = 'left';

		const label = document.createElement('b');

		label.textContent = buttonText + ': ';

		line.appendChild(label);

		outcomes.forEach((outcome, index) => {

			const resultWrapper = document.createElement('span');

			if (index > 0) {
				const separator = document.createElement('span');
				separator.textContent = 'OR';
				separator.style.fontWeight = 'bold';
				separator.style.marginLeft = '4px';
				separator.style.marginRight = '4px';

				resultWrapper.appendChild(separator);
			}

			resultWrapper.appendChild(createResultElement(outcome));

			line.appendChild(resultWrapper);
		});

		return line;
	}

	function appendFormattedText(container, text) {
		const regex = /'''([^']+)'''|''([^']+)''/g;
		let lastIndex = 0;
		let match;

		while ((match = regex.exec(text)) !== null) {

			if (match.index > lastIndex) {
				container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
			}

			// Bold: '''text'''
			if (match[1] !== undefined) {
				const bold = document.createElement('b');
				bold.textContent = match[1];
				container.appendChild(bold);
			}

			// Italic: ''text''
			else if (match[2] !== undefined) {
				const italic = document.createElement('i');
				italic.textContent = match[2];
				container.appendChild(italic);
			}

			lastIndex = regex.lastIndex;
		}

		if (lastIndex < text.length) {
			container.appendChild(document.createTextNode(text.slice(lastIndex)));
		}
	}

	function createNoteLine(noteText) {
		const line = document.createElement('div');

		const parts = noteText.split(',');

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i].trim();

			if (!part) {
				continue;
			}

			const separator = part.indexOf('|');

			const partWrapper = document.createElement('span');

			if (separator === -1) {
				appendFormattedText(partWrapper, part);
			} else {
				const separators = part.split('|');

				const text = separators[0].trim();

				const afterText = separators.slice(2).join('|').trim();

				if (text) {
					appendFormattedText(partWrapper, text);
				}

				if (afterText) {
					partWrapper.appendChild(document.createTextNode(afterText));
				}
			}

			if (i < parts.length - 1) {
				partWrapper.appendChild(document.createTextNode(', '));
			}

			line.appendChild(partWrapper);
		}

		return line;
	}

	function createNotesElement(notes, conditional, details, location, buttons) {
		if (!notes && !conditional && !details && !location) {
			return null;
		}

		const noteList = Array.isArray(notes) ? [...notes] : notes ? [notes] : [];

		if (noteList.length === 0) {
			return null;
		}

		const container = document.createElement('div');
		container.style.marginTop = '8px';
		container.style.textAlign = 'left';

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
				matchingConditional = conditionalEntries.find(
					([buttonName]) => {
						if (!matchOptionName(buttonName, specifiedOption)) {
							return false;
						}

						return [...buttons].some(button =>
							matchOptionName(button.textContent, specifiedOption)
						);
					}
				);
			}

			if (!specifiedOption) {
				matchingConditional = conditionalEntries.find(
					([buttonName]) => {
						return [...buttons].some(button =>
							matchOptionName(button.textContent, buttonName)
						);
					}
				);
			}

			if (!matchingConditional) {
				continue;
			}

			const [buttonName, conditionalValue] = matchingConditional;

			const conditionalNotes = Array.isArray(conditionalValue) ? conditionalValue : [conditionalValue];

			const conditionalNote = conditionalNotes[conditionalIndex];

			if (conditionalNote === undefined) {
				continue;
			}

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
					const detailLine = document.createElement('div');
					detailLine.style.whiteSpace = 'normal';

					const detailText = conditionalPrefix + detailPrefix + resolveReferences(String(details[detailIndex]), location);

					appendFormattedText(detailLine, detailText);

					container.appendChild(detailLine);
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
				const detailLine = document.createElement('div');
				detailLine.style.whiteSpace = 'normal';

				const detailText = detailPrefix + resolveReferences(String(details[detailIndex]), location);

				appendFormattedText(detailLine, detailText);

				container.appendChild(detailLine);
			}

			continue;
		}

    noteText = resolveReferences(noteText, location);

		container.appendChild(createNoteLine(noteText));

		}

		if (container.children.length === 1) {
			return null;
		}

		return container;
	}

	function clearExploreHelper() {
		const helpers = document.querySelectorAll('.' + HELPER_CLASS);

		helpers.forEach(helper => helper.remove());
	}

	function updateExploreOutput() {
		const output = document.querySelector('#explore-output');

		if (!output || !encounterDatabase) {
			return;
		}

		const encounter = findCurrentEncounter(output);

		if (!encounter) {
			clearExploreHelper();
			return;
		}

		const buttons = output.querySelectorAll('button');

		const resultLines = [];

		for (const button of buttons) {
			const buttonText = button.textContent.trim();

			let matchedName = null;
			let matchedValue = null;
			let matchedOption = null;

			for (const [optionName, optionValue] of Object.entries(encounter.data.options || {})) {
				if (!matchOptionName(buttonText, optionName)) {
					continue;
				}

				const isSeasonal = /\s*\[(spring|summer|autumn|winter)\]$/i.test(optionName);

				const candidate = {
					name: optionName,
					value: optionValue,
					isSeasonal: isSeasonal
				};

				if (!matchedOption) {
					matchedOption = candidate;
					continue;
				}

				if (isSeasonal && !matchedOption.isSeasonal) {
					matchedOption = candidate;
				}
			}

			if (matchedOption) {
				matchedName = matchedOption.name;
				matchedValue = matchedOption.value;
			}

			if (matchedName === null && encounter.data.steps) {
				for (const stepName of Object.keys(encounter.data.steps)) {
					if (normalizeText(buttonText) === normalizeText(stepName)) {
						resultLines.push(...createStepResultLines(encounter, [stepName]));

						matchedName = stepName;
						break;
					}
				}
			}

			if (matchedName === null) {
				continue;
			}

			if (isStepOption(matchedValue)) {
				resultLines.push(
					...createStepPreviewLines(buttonText, matchedValue.steps, encounter)
				);

				continue;
			}

			resultLines.push(
				createResultLine(
					matchedName.replace(/\s*\[(spring|summer|autumn|winter)\]$/i, ''),
					parseResult(matchedValue, encounter.data.location)
				)
			);
		}

		if (resultLines.length === 0) {

			const notes = createNotesElement(encounter.data.notes, encounter.data.conditional, encounter.data.details, encounter.data.location, buttons);

			clearExploreHelper();

			if (!notes) {
				return;
			}

			const helper = document.createElement('div');
			helper.className = HELPER_CLASS;
			helper.style.marginTop = HELPER_MARGINS;
			helper.style.marginBottom = HELPER_MARGINS;

			if (notes) {
				helper.appendChild(notes);
			}

			const energyMessage = [...output.querySelectorAll('p')]
				.find(p => /^\s*you lost\s+-\d+%\s+energy exploring\.?\s*$/i.test(p.textContent.trim()));

			const essenceMessage = [...output.querySelectorAll('p')]
				.find(p => /^\s*-\d+\s+lunar essence\s*$/i.test(p.textContent.trim()));

			if (energyMessage) {
				energyMessage.before(helper);
			} else if (essenceMessage) {
				essenceMessage.before(helper);
			} else {
				output.appendChild(helper);
			}

			return;
		}

		let helper = output.querySelector('.' + HELPER_CLASS);

		if (!helper) {
			helper = document.createElement('div');
			helper.className = HELPER_CLASS;
			helper.style.marginTop = HELPER_MARGINS;
			helper.style.marginBottom = HELPER_MARGINS;
		}

		helper.replaceChildren();

		for (const line of resultLines) {
			helper.appendChild(line);
		}

		const notes = createNotesElement(encounter.data.notes, encounter.data.conditional, encounter.data.details, encounter.data.location, buttons);

		if (notes) {
			helper.appendChild(notes);
		}

		const energyMessage = [...output.querySelectorAll('p')]
			.find(p => /^\s*you lost\s+-\d+%\s+energy exploring\.?\s*$/i.test(p.textContent.trim()));

		const essenceMessage = [...output.querySelectorAll('p')]
			.find(p => /^\s*-\d+\s+lunar essence\s*$/i.test(p.textContent.trim()));

		if (energyMessage) {
			energyMessage.before(helper);
		} else if (essenceMessage) {
			essenceMessage.before(helper);
		} else {
			output.appendChild(helper);
		}
	}

	function waitForExploreChange() {
		const output = document.querySelector('#explore-output');

		if (!output) {
			setTimeout(waitForExploreChange, 50);
			return;
		}

		const oldHTML = output.innerHTML;
		let changed = false;

		const observer = new MutationObserver(() => {
			if (changed || output.innerHTML === oldHTML) {
				return;
			}

			changed = true;
			observer.disconnect();

			requestAnimationFrame(() => {
				updateExploreOutput();
			});
		});

		observer.observe(output, {
			childList: true,
			subtree: true,
			characterData: true
		});

		setTimeout(() => {
			observer.disconnect();
		}, WAIT_TIMEOUT);
	}

	document.addEventListener('click', function (event) {

		const exploreLink = event.target.closest('#explore-explore-link');

		if (!exploreLink) {
			return;
		}

		clearExploreHelper();

		waitForExploreChange();
	});

	loadDatabase();

})();