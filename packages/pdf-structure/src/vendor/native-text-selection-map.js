// Pinned port of Zotero's DOM-selection-to-character mapping, copied verbatim.
//
// Source: zotero/reader `src/pdf/native-text-selection-map.mjs`, pinned at
//   zotero/zotero  22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c
//   zotero/reader  132bb787937a540a09513415fd507654eb0e88f9
//   zotero/pdf.js  f57fc80d1c07e4cdc50a767ae0b500b5272123b4
//
// pdf-reader is copyright © 2020–2021 Corporation for Digital Scholarship,
// Vienna, Virginia, USA, and distributed under the GNU Affero General Public
// License v3 (zotero/reader `COPYING`). Upstream carries no per-file header;
// ZotLit's AGPL-3.0-or-later grant lets this copy be distributed under AGPL v3.
//
// Every byte after the marker is upstream. Refresh the whole body from a newer
// checkout when the golden parity test fails; never hand-edit it.
//
// @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/native-text-selection-map.mjs
// === verbatim upstream copy starts here ===
const ALIGNMENT_LOOKAHEAD = 32;
const ALIGNMENT_MATCH_LENGTH = 8;

export function getNormalizedUnits(text) {
	let units = [];
	for (let character of text || '') {
		for (let normalizedCharacter of character.normalize('NFKD')) {
			if (!/\s/u.test(normalizedCharacter)) {
				units.push(normalizedCharacter);
			}
		}
	}
	return units;
}

function normalizeText(text) {
	// PDF.js preserves visible line-end hyphens in Selection.toString(), while
	// Reader's character model marks discretionary hyphens as ignorable.
	text = (text || '')
		.replace(/-(?:\r\n?|\n)\s*/gu, '')
		.replace(/-$/u, '');
	return getNormalizedUnits(text).join('');
}

function hasMatchingRun(a, b, aIndex, bIndex, length) {
	for (let i = 0; i < length; i++) {
		if (a[aIndex + i] !== b[bIndex + i]) {
			return false;
		}
	}
	return true;
}

function findNextAlignment(a, b, aIndex, bIndex) {
	let best = null;
	let maxA = Math.min(ALIGNMENT_LOOKAHEAD, a.length - aIndex);
	let maxB = Math.min(ALIGNMENT_LOOKAHEAD, b.length - bIndex);
	for (let aDelta = 0; aDelta <= maxA; aDelta++) {
		for (let bDelta = 0; bDelta <= maxB; bDelta++) {
			if (!aDelta && !bDelta) {
				continue;
			}
			let cost = aDelta + bDelta;
			if (best && cost >= best.cost) {
				continue;
			}
			let availableLength = Math.min(
				a.length - aIndex - aDelta,
				b.length - bIndex - bDelta
			);
			let matchingLength = Math.min(ALIGNMENT_MATCH_LENGTH, availableLength);
			if (hasMatchingRun(a, b, aIndex + aDelta, bIndex + bDelta, matchingLength)) {
				best = { aDelta, bDelta, cost };
			}
		}
	}
	return best;
}

export function alignTextUnits(domUnits, readerUnits) {
	let offsets = new Array(domUnits.length + 1);
	let domOffset = 0;
	let readerOffset = 0;
	offsets[0] = 0;

	while (domOffset < domUnits.length && readerOffset < readerUnits.length) {
		if (domUnits[domOffset] === readerUnits[readerOffset]) {
			domOffset++;
			readerOffset++;
			offsets[domOffset] = readerOffset;
			continue;
		}

		let alignment = findNextAlignment(domUnits, readerUnits, domOffset, readerOffset);
		if (!alignment) {
			domOffset++;
			readerOffset++;
			offsets[domOffset] = readerOffset;
			continue;
		}

		let { aDelta, bDelta } = alignment;
		for (let i = 1; i <= aDelta; i++) {
			offsets[domOffset + i] = readerOffset + Math.round(i * bDelta / aDelta);
		}
		domOffset += aDelta;
		readerOffset += bDelta;
		offsets[domOffset] = readerOffset;
	}

	while (domOffset < domUnits.length) {
		offsets[++domOffset] = readerOffset;
	}
	offsets[domUnits.length] = readerUnits.length;
	return offsets;
}

export function buildReaderUnitMap(chars) {
	let readerUnits = [];
	let readerStartOffsets = [];
	let readerEndOffsets = [];
	let normalizedOffset = 0;
	readerStartOffsets[0] = 0;
	readerEndOffsets[0] = 0;
	for (let i = 0; i < chars.length; i++) {
		let units = chars[i].ignorable ? [] : getNormalizedUnits(chars[i].c);
		if (!units.length) {
			readerStartOffsets[normalizedOffset] = i + 1;
			continue;
		}

		let start = normalizedOffset;
		readerStartOffsets[start] = i;
		readerEndOffsets[start] = i;
		readerUnits.push(...units);
		normalizedOffset += units.length;
		for (let boundary = start + 1; boundary < normalizedOffset; boundary++) {
			readerStartOffsets[boundary] = i;
			readerEndOffsets[boundary] = i + 1;
		}
		readerStartOffsets[normalizedOffset] = i + 1;
		readerEndOffsets[normalizedOffset] = i + 1;
	}
	readerStartOffsets[normalizedOffset] ??= chars.length;
	readerEndOffsets[normalizedOffset] ??= chars.length;
	return { readerUnits, readerStartOffsets, readerEndOffsets };
}

export function getMappedSelectionEndpoints(selectionInfo, anchorMap, focusMap) {
	let anchorOffset = anchorMap.getReaderOffset(
		selectionInfo.selection.anchorNode,
		selectionInfo.selection.anchorOffset,
		selectionInfo.anchorIsStart ? 'start' : 'end'
	);
	let focusOffset = focusMap.getReaderOffset(
		selectionInfo.selection.focusNode,
		selectionInfo.selection.focusOffset,
		selectionInfo.anchorIsStart ? 'end' : 'start'
	);
	if (anchorOffset === null || focusOffset === null) {
		return null;
	}
	return {
		anchor: {
			pageIndex: selectionInfo.anchorPageIndex,
			offset: anchorOffset
		},
		focus: {
			pageIndex: selectionInfo.focusPageIndex,
			offset: focusOffset
		}
	};
}

export function selectionTextMatches(selectionText, rangeText) {
	return normalizeText(selectionText) === normalizeText(rangeText);
}

export function getMatchingSelectionRanges(selectionText, mappedRanges, getRangeText, getFallbackRanges) {
	if (mappedRanges?.length && selectionTextMatches(selectionText, getRangeText(mappedRanges))) {
		return mappedRanges;
	}
	let fallbackRanges = getFallbackRanges();
	return fallbackRanges?.length
		&& selectionTextMatches(selectionText, getRangeText(fallbackRanges))
		? fallbackRanges
		: null;
}
