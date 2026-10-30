// Pinned port of Zotero's PDF text-structure module, copied verbatim.
//
// Source: zotero/pdf.js `src/core/module/structure.js`, pinned at
//   zotero/zotero  22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c
//   zotero/reader  132bb787937a540a09513415fd507654eb0e88f9
//   zotero/pdf.js  f57fc80d1c07e4cdc50a767ae0b500b5272123b4
//
// `src/core/module/` belongs to zotero/pdf.js, an Apache-2.0 submodule of the
// AGPL-3.0 zotero/reader, so the reader's AGPL does not reach this file and
// Apache-2.0 into AGPL-3.0-or-later is permitted. The body below carries
// Mozilla's `bidi.js` inline, under its own Apache-2.0 notice:
//
//   Copyright 2012 Mozilla Foundation
//
//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.
//
// Every byte after the marker is upstream. Refresh the whole body from a newer
// checkout when the golden parity test fails; never hand-edit it.
//
// @see https://github.com/zotero/pdf.js/blob/f57fc80d1c07e4cdc50a767ae0b500b5272123b4/src/core/module/structure.js
//
// === verbatim upstream copy starts here ===
// NOTE: Do not modify this file as it can affect all other analyzer parts

// *** bidi.js starts here ***
// This is taken from PDF.js source https://github.com/mozilla/pdf.js/blob/9416b14e8b06a39a1a57f2baf22aebab2370edeb/src/core/bidi.js

/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Character types for symbols from 0000 to 00FF.
// Source: ftp://ftp.unicode.org/Public/UNIDATA/UnicodeData.txt
// prettier-ignore
let baseTypes = [
  "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "S", "B", "S",
  "WS", "B", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN",
  "BN", "BN", "BN", "BN", "B", "B", "B", "S", "WS", "ON", "ON", "ET",
  "ET", "ET", "ON", "ON", "ON", "ON", "ON", "ES", "CS", "ES", "CS", "CS",
  "EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "EN", "CS", "ON",
  "ON", "ON", "ON", "ON", "ON", "L", "L", "L", "L", "L", "L", "L", "L",
  "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L",
  "L", "L", "L", "L", "ON", "ON", "ON", "ON", "ON", "ON", "L", "L", "L",
  "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L",
  "L", "L", "L", "L", "L", "L", "L", "L", "L", "ON", "ON", "ON", "ON",
  "BN", "BN", "BN", "BN", "BN", "BN", "B", "BN", "BN", "BN", "BN", "BN",
  "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN",
  "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "CS", "ON", "ET",
  "ET", "ET", "ET", "ON", "ON", "ON", "ON", "L", "ON", "ON", "BN", "ON",
  "ON", "ET", "ET", "EN", "EN", "ON", "L", "ON", "ON", "ON", "EN", "L",
  "ON", "ON", "ON", "ON", "ON", "L", "L", "L", "L", "L", "L", "L", "L",
  "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L",
  "L", "ON", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L",
  "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L", "L",
  "L", "L", "L", "L", "L", "ON", "L", "L", "L", "L", "L", "L", "L", "L"
];

// Character types for symbols from 0600 to 06FF.
// Source: ftp://ftp.unicode.org/Public/UNIDATA/UnicodeData.txt
// Note that 061D does not exist in the Unicode standard (see
// http://unicode.org/charts/PDF/U0600.pdf), so we replace it with an
// empty string and issue a warning if we encounter this character. The
// empty string is required to properly index the items after it.
// prettier-ignore
let arabicTypes = [
  "AN", "AN", "AN", "AN", "AN", "AN", "ON", "ON", "AL", "ET", "ET", "AL",
  "CS", "AL", "ON", "ON", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM",
  "NSM", "NSM", "NSM", "NSM", "AL", "AL", "", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "AL", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM",
  "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM",
  "NSM", "NSM", "NSM", "NSM", "AN", "AN", "AN", "AN", "AN", "AN", "AN",
  "AN", "AN", "AN", "ET", "AN", "AN", "AL", "AL", "AL", "NSM", "AL", "AL",
  "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL", "AL",
  "AL", "AL", "AL", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "AN",
  "ON", "NSM", "NSM", "NSM", "NSM", "NSM", "NSM", "AL", "AL", "NSM", "NSM",
  "ON", "NSM", "NSM", "NSM", "NSM", "AL", "AL", "EN", "EN", "EN", "EN",
  "EN", "EN", "EN", "EN", "EN", "EN", "AL", "AL", "AL", "AL", "AL", "AL"
];

function isOdd(i) {
  return (i & 1) !== 0;
}

function isEven(i) {
  return (i & 1) === 0;
}

function findUnequal(arr, start, value) {
  let j, jj;
  for (j = start, jj = arr.length; j < jj; ++j) {
    if (arr[j] !== value) {
      return j;
    }
  }
  return j;
}

function setValues(arr, start, end, value) {
  for (let j = start; j < end; ++j) {
    arr[j] = value;
  }
}

function reverseValues(arr, start, end) {
  for (let i = start, j = end - 1; i < j; ++i, --j) {
    let temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
}

function createBidiText(chars, isLTR, vertical = false) {
  let dir = "ltr";
  if (vertical) {
    dir = "ttb";
  }
  else if (!isLTR) {
    dir = "rtl";
  }
  return { chars, dir };
}

// These are used in bidi(), which is called frequently. We re-use them on
// each call to avoid unnecessary allocations.
let types = [];

function bidi(chars, startLevel = -1, vertical = false) {
  let isLTR = true;
  let strLength = chars.length;
  if (strLength === 0 || vertical) {
    return createBidiText(chars, isLTR, vertical);
  }

  // Get types and fill arrays
  types.length = strLength;
  let numBidi = 0;

  let i, ii;
  for (i = 0; i < strLength; ++i) {

    let charCode = chars[i].c.charCodeAt(0);
    let charType = "L";
    if (charCode <= 0x00ff) {
      charType = baseTypes[charCode];
    }
    else if (0x0590 <= charCode && charCode <= 0x05f4) {
      charType = "R";
    }
    else if (0x0600 <= charCode && charCode <= 0x06ff) {
      charType = arabicTypes[charCode & 0xff];
      if (!charType) {
        console.log("Bidi: invalid Unicode character " + charCode.toString(16));
      }
    }
    else if (0x0700 <= charCode && charCode <= 0x08ac) {
      charType = "AL";
    }
    if (charType === "R" || charType === "AL" || charType === "AN") {
      numBidi++;
    }
    types[i] = charType;
  }

  // Detect the bidi method
  // - If there are no rtl characters then no bidi needed
  // - If less than 30% chars are rtl then string is primarily ltr,
  //   unless the string is very short.
  // - If more than 30% chars are rtl then string is primarily rtl
  if (numBidi === 0) {
    isLTR = true;
    return createBidiText(chars, isLTR);
  }

  if (startLevel === -1) {
    if (numBidi / strLength < 0.3 && strLength > 4) {
      isLTR = true;
      startLevel = 0;
    }
    else {
      isLTR = false;
      startLevel = 1;
    }
  }

  let levels = [];
  for (i = 0; i < strLength; ++i) {
    levels[i] = startLevel;
  }

  /*
   X1-X10: skip most of this, since we are NOT doing the embeddings.
   */
  let e = isOdd(startLevel) ? "R" : "L";
  let sor = e;
  let eor = sor;

  /*
   W1. Examine each non-spacing mark (NSM) in the level run, and change the
   type of the NSM to the type of the previous character. If the NSM is at the
   start of the level run, it will get the type of sor.
   */
  let lastType = sor;
  for (i = 0; i < strLength; ++i) {
    if (types[i] === "NSM") {
      types[i] = lastType;
    }
    else {
      lastType = types[i];
    }
  }

  /*
   W2. Search backwards from each instance of a European number until the
   first strong type (R, L, AL, or sor) is found.  If an AL is found, change
   the type of the European number to Arabic number.
   */
  lastType = sor;
  let t;
  for (i = 0; i < strLength; ++i) {
    t = types[i];
    if (t === "EN") {
      types[i] = lastType === "AL" ? "AN" : "EN";
    }
    else if (t === "R" || t === "L" || t === "AL") {
      lastType = t;
    }
  }

  /*
   W3. Change all ALs to R.
   */
  for (i = 0; i < strLength; ++i) {
    t = types[i];
    if (t === "AL") {
      types[i] = "R";
    }
  }

  /*
   W4. A single European separator between two European numbers changes to a
   European number. A single common separator between two numbers of the same
   type changes to that type:
   */
  for (i = 1; i < strLength - 1; ++i) {
    if (types[i] === "ES" && types[i - 1] === "EN" && types[i + 1] === "EN") {
      types[i] = "EN";
    }
    if (
      types[i] === "CS" &&
      (types[i - 1] === "EN" || types[i - 1] === "AN") &&
      types[i + 1] === types[i - 1]
    ) {
      types[i] = types[i - 1];
    }
  }

  /*
   W5. A sequence of European terminators adjacent to European numbers changes
   to all European numbers:
   */
  for (i = 0; i < strLength; ++i) {
    if (types[i] === "EN") {
      // do before
      for (let j = i - 1; j >= 0; --j) {
        if (types[j] !== "ET") {
          break;
        }
        types[j] = "EN";
      }
      // do after
      for (let j = i + 1; j < strLength; ++j) {
        if (types[j] !== "ET") {
          break;
        }
        types[j] = "EN";
      }
    }
  }

  /*
   W6. Otherwise, separators and terminators change to Other Neutral:
   */
  for (i = 0; i < strLength; ++i) {
    t = types[i];
    if (t === "WS" || t === "ES" || t === "ET" || t === "CS") {
      types[i] = "ON";
    }
  }

  /*
   W7. Search backwards from each instance of a European number until the
   first strong type (R, L, or sor) is found. If an L is found,  then change
   the type of the European number to L.
   */
  lastType = sor;
  for (i = 0; i < strLength; ++i) {
    t = types[i];
    if (t === "EN") {
      types[i] = lastType === "L" ? "L" : "EN";
    }
    else if (t === "R" || t === "L") {
      lastType = t;
    }
  }

  /*
   N1. A sequence of neutrals takes the direction of the surrounding strong
   text if the text on both sides has the same direction. European and Arabic
   numbers are treated as though they were R. Start-of-level-run (sor) and
   end-of-level-run (eor) are used at level run boundaries.
   */
  for (i = 0; i < strLength; ++i) {
    if (types[i] === "ON") {
      let end = findUnequal(types, i + 1, "ON");
      let before = sor;
      if (i > 0) {
        before = types[i - 1];
      }

      let after = eor;
      if (end + 1 < strLength) {
        after = types[end + 1];
      }
      if (before !== "L") {
        before = "R";
      }
      if (after !== "L") {
        after = "R";
      }
      if (before === after) {
        setValues(types, i, end, before);
      }
      i = end - 1; // reset to end (-1 so next iteration is ok)
    }
  }

  /*
   N2. Any remaining neutrals take the embedding direction.
   */
  for (i = 0; i < strLength; ++i) {
    if (types[i] === "ON") {
      types[i] = e;
    }
  }

  /*
   I1. For all characters with an even (left-to-right) embedding direction,
   those of type R go up one level and those of type AN or EN go up two
   levels.
   I2. For all characters with an odd (right-to-left) embedding direction,
   those of type L, EN or AN go up one level.
   */
  for (i = 0; i < strLength; ++i) {
    t = types[i];
    if (isEven(levels[i])) {
      if (t === "R") {
        levels[i] += 1;
      }
      else if (t === "AN" || t === "EN") {
        levels[i] += 2;
      }
    }
    else {
      // isOdd
      if (t === "L" || t === "AN" || t === "EN") {
        levels[i] += 1;
      }
    }
  }

  /*
   L1. On each line, reset the embedding level of the following characters to
   the paragraph embedding level:

   segment separators,
   paragraph separators,
   any sequence of whitespace characters preceding a segment separator or
   paragraph separator, and any sequence of white space characters at the end
   of the line.
   */

  // don't bother as text is only single line

  /*
   L2. From the highest level found in the text to the lowest odd level on
   each line, reverse any contiguous sequence of characters that are at that
   level or higher.
   */

  // find highest level & lowest odd level
  let highestLevel = -1;
  let lowestOddLevel = 99;
  let level;
  for (i = 0, ii = levels.length; i < ii; ++i) {
    level = levels[i];
    if (highestLevel < level) {
      highestLevel = level;
    }
    if (lowestOddLevel > level && isOdd(level)) {
      lowestOddLevel = level;
    }
  }

  // now reverse between those limits
  for (level = highestLevel; level >= lowestOddLevel; --level) {
    // find segments to reverse
    let start = -1;
    for (i = 0, ii = levels.length; i < ii; ++i) {
      if (levels[i] < level) {
        if (start >= 0) {
          reverseValues(chars, start, i);
          start = -1;
        }
      }
      else if (start < 0) {
        start = i;
      }
    }
    if (start >= 0) {
      reverseValues(chars, start, levels.length);
    }
  }

  /*
   L3. Combining marks applied to a right-to-left base character will at this
   point precede their base character. If the rendering engine expects them to
   follow the base characters in the final display process, then the ordering
   of the marks and the base character must be reversed.
   */

  // don't bother for now

  /*
   L4. A character that possesses the mirrored property as specified by
   Section 4.7, Mirrored, must be depicted by a mirrored glyph if the resolved
   directionality of that character is R.
   */

  // don't mirror as characters are already mirrored in the pdf

  // Finally, return string
  for (i = 0, ii = chars.length; i < ii; ++i) {
    let ch = chars[i];
    if (ch === "<" || ch === ">") {
      chars[i] = "";
    }
  }
  return createBidiText(chars, isLTR);
}

function isRTL(char) {
  let charCode = char.charCodeAt(0);
  let charType = "L";
  if (charCode <= 0x00ff) {
    charType = baseTypes[charCode];
  }
  else if (0x0590 <= charCode && charCode <= 0x05f4) {
    charType = "R";
  }
  else if (0x0600 <= charCode && charCode <= 0x06ff) {
    charType = arabicTypes[charCode & 0xff];
    if (!charType) {
      console.log("Bidi: invalid Unicode character " + charCode.toString(16));
    }
  }
  else if (0x0700 <= charCode && charCode <= 0x08ac) {
    charType = "AL";
  }
  if (charType === "R" || charType === "AL" || charType === "AN") {
    return true;
  }
  return false;
}

// *** bidi.js ends here ***



// The function is adapted from Xpdf https://www.xpdfreader.com/opensource.html
// Original copyright: 1996-2019 Glyph & Cog, LLC.
function computeWordSpacingThreshold(chars) {
  // Inter-character spacing that varies by less than this multiple of
  // font size is assumed to be equivalent.
  let uniformSpacing = 0.07;
  // Typical word spacing, as a fraction of font size.  This will be
  // added to the minimum inter-character spacing, to account for wide
  // character spacing.
  let wordSpacing = 0.1;
  // Compute the inter-word spacing threshold for a line of chars.
  // Spaces greater than this threshold will be considered inter-word
  // spaces.

  let char, char2;
  let avgFontSize;
  let minAdjGap, maxAdjGap, minSpGap, maxSpGap, minGap, maxGap, gap, gap2;
  let i;

  avgFontSize = 0;
  minGap = maxGap = 0;
  minAdjGap = minSpGap = 1;
  maxAdjGap = maxSpGap = 0;
  for (i = 0; i < chars.length; ++i) {
    char = chars[i];
    avgFontSize += char.fontSize;
    if (i < chars.length - 1) {
      char2 = chars[i + 1];
      gap = getSpaceBetweenChars(char, char2);
      if (char.spaceAfter) {
        if (minSpGap > maxSpGap) {
          minSpGap = maxSpGap = gap;
        }
        else if (gap < minSpGap) {
          minSpGap = gap;
        }
        else if (gap > maxSpGap) {
          maxSpGap = gap;
        }
      }
      else if (minAdjGap > maxAdjGap) {
        minAdjGap = maxAdjGap = gap;
      }
      else if (gap < minAdjGap) {
        minAdjGap = gap;
      }
      else if (gap > maxAdjGap) {
        maxAdjGap = gap;
      }
      if (i == 0 || gap < minGap) {
        minGap = gap;
      }
      if (gap > maxGap) {
        maxGap = gap;
      }
    }
  }
  avgFontSize /= chars.length;
  if (minGap < 0) {
    minGap = 0;
  }

  // if spacing is nearly uniform (minGap is close to maxGap), use the
  // SpGap/AdjGap values if available, otherwise assume it's a single
  // word (technically it could be either "ABC" or "A B C", but it's
  // essentially impossible to tell)
  if (maxGap - minGap < uniformSpacing * avgFontSize) {
    if (minAdjGap <= maxAdjGap
      && minSpGap <= maxSpGap
      && minSpGap - maxAdjGap > 0.01) {
      return 0.5 * (maxAdjGap + minSpGap);
    }
    else {
      return maxGap + 1;
    }

    // if there is some variation in spacing, but it's small, assume
    // there are some inter-word spaces
  }
  else if (maxGap - minGap < wordSpacing * avgFontSize) {
    return 0.5 * (minGap + maxGap);

    // if there is a large variation in spacing, use the SpGap/AdjGap
    // values if they look reasonable, otherwise, assume a reasonable
    // threshold for inter-word spacing (we can't use something like
    // 0.5*(minGap+maxGap) here because there can be outliers at the
    // high end)
  }
  else if (minAdjGap <= maxAdjGap
    && minSpGap <= maxSpGap
    && minSpGap - maxAdjGap > uniformSpacing * avgFontSize) {
    gap = wordSpacing * avgFontSize;
    gap2 = 0.5 * (minSpGap - minGap);
    return minGap + (gap < gap2 ? gap : gap2);
  }
  else {
    return minGap + wordSpacing * avgFontSize;
  }
}

function getSpaceBetweenChars(char, char2) {
  let { rotation } = char;
  return !rotation && char2.rect[0] - char.rect[2]
  || rotation === 90 && char2.rect[1] - char.rect[3]
  || rotation === 180 && char.rect[0] - char2.rect[2]
  || rotation === 270 && char.rect[1] - char2.rect[3]
}

function overlaps(rect1, rect2, rotation) {
  if ([0, 180].includes(rotation)) {
    return (rect1[1] <= rect2[1] && rect2[1] <= rect1[3]
      || rect2[1] <= rect1[1] && rect1[1] <= rect2[3]);
  }
  return (
    rect1[0] <= rect2[0] && rect2[0] <= rect1[2]
    || rect2[0] <= rect1[0] && rect1[0] <= rect2[2]
  );
}

const dashChars = new Set([
  '\x2D', '\u058A', '\u05BE', '\u1400', '\u1806',
  '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015',
  '\u2E17', '\u2E1A', '\u2E3A', '\u2E3B', '\u301C', '\u3030',
  '\u30A0', '\uFE31', '\uFE32', '\uFE58', '\uFE63', '\uFF0D'
]);

function charHeight(char) {
  return ([0, 180].includes(char.rotation) && char.rect[3] - char.rect[1]
    || [90, 270].includes(char.rotation) && char.rect[2] - char.rect[0]);
}

function getBoundingRect(objs, from, to) {
  let objs2 = objs.slice(from, to + 1);
  return [
    Math.min(...objs2.map(x => x.rect[0])),
    Math.min(...objs2.map(x => x.rect[1])),
    Math.max(...objs2.map(x => x.rect[2])),
    Math.max(...objs2.map(x => x.rect[3])),
  ];
}

function roundRect(rect) {
  return rect.map(n => Math.round(n * 1000) / 1000);
}

function median(values) {
  if(values.length ===0) throw new Error("No inputs");

  values.sort(function(a,b){
    return a-b;
  });

  var half = Math.floor(values.length / 2);

  if (values.length % 2)
    return values[half];

  return (values[half - 1] + values[half]) / 2.0;
}

function getLineBottom(chars, from, to) {
  let values = [];
  for (let i = from; i <= to; i++) {
    let char = chars[i];
    if (char.rotation === 0) {
      values.push(char.rect[1]);
    }
    else if (char.rotation === 90) {
      values.push(char.rect[2]);
    }
    else if (char.rotation === 180) {
      values.push(char.rect[3]);
    }
    else if (char.rotation === 270) {
      values.push(char.rect[0]);
    }
  }
  return median(values);
}

function getLineTop(chars, from, to) {
  let values = [];
  for (let i = from; i <= to; i++) {
    let char = chars[i];
    if (char.rotation === 0) {
      values.push(char.rect[3]);
    }
    else if (char.rotation === 90) {
      values.push(char.rect[0]);
    }
    else if (char.rotation === 180) {
      values.push(char.rect[1]);
    }
    else if (char.rotation === 270) {
      values.push(char.rect[2]);
    }
  }
  return median(values);
}

function mostCommonFontName(chars) {
  const fontCount = {};

  // Count each fontName in the array
  for (let i = 0; i < chars.length; i++) {
    const fontName = chars[i].fontName;
    fontCount[fontName] = (fontCount[fontName] || 0) + 1;
  }

  // Find the fontName with the highest count
  let mostCommonFont = null;
  let maxCount = 0;
  for (const fontName in fontCount) {
    if (fontCount[fontName] > maxCount) {
      maxCount = fontCount[fontName];
      mostCommonFont = fontName;
    }
  }

  return mostCommonFont;
}

function split(chars, reflowRTL) {
  if (!chars.length) {
    return [];
  }
  let lines = [];

  let hasRTL = false;
  for (let char of chars) {
    if (isRTL(char.c)) {
      hasRTL = true;
      break;
    }
  }

  let lineBreaks = [];

  for (let i = 1; i < chars.length; i++) {
    let char = chars[i - 1];
    let char2 = chars[i];
    if (
      // Caret jumps to the next line start for non-RTL text and baseline isn't the same.
      // (characters can sometimes even jump back in the same line)
      !hasRTL && Math.abs(char.baseline - char2.baseline) > 0.01 && (
        !char2.rotation && char.rect[0] - 10 > char2.rect[0]
        || char2.rotation === 90 && char.rect[1] > char2.rect[1]
        || char2.rotation === 180 && char.rect[0] < char2.rect[0]
        || char2.rotation === 270 && char.rect[1] < char2.rect[1]
      )
      || hasRTL && Math.abs(char.baseline - char2.baseline) > 0.01
      // Rotation changes
      || char.rotation !== char2.rotation
      // Chars aren't in the same line
      || !overlaps(char.rect, char2.rect, char2.rotation)
      // Line's first char is more than 2x larger than the following char, to put drop cap into a separate line
      || lineBreaks.find(x => x === i - 1) && charHeight(char) > charHeight(char2) * 2
    ) {
      lineBreaks.push(i);
    }
  }

  lineBreaks = [0, ...lineBreaks, chars.length];

  // Sort characters in lines by their visual order. That fixes some RTL lines
  // and weird cases when caret jumps back in the same line for LTR text
  for (let i = 0; i < lineBreaks.length - 1; i++) {
    let from = lineBreaks[i];
    let to = lineBreaks[i + 1] - 1;
    let lineChars = chars.slice(from, to + 1);
    lineChars.sort((a, b) => {
      let { rotation } = a;
      let x1 = a.rect[0] + (a.rect[2] - a.rect[0]) / 2;
      let x2 = b.rect[0] + (b.rect[2] - b.rect[0]) / 2;
      let y1 = a.rect[1] + (a.rect[3] - a.rect[1]) / 2;
      let y2 = b.rect[1] + (b.rect[3] - b.rect[1]) / 2;

      return !rotation && x1 - x2
        || rotation === 90 && y1 - y2
        || rotation === 180 && x2 - x1
        || rotation === 270 && y2 - y1
    });
    bidi(lineChars, -1, false);
    chars.splice(from, to - from + 1, ...lineChars);
  }

  let wordBreaks = [];
  let wordSpaces = [];
  // Get word breaks
  for (let i = 0; i < lineBreaks.length - 1; i++) {
    let from = lineBreaks[i];
    let to = lineBreaks[i + 1] - 1;
    let wordSp = computeWordSpacingThreshold(chars.slice(from, to + 1));
    let spaces = [];
    for (let j = from + 1; j <= to; j++) {
      let sp = wordSp - 1;

      let char = chars[j - 1];
      let char2 = chars[j];

      let rtl = isRTL(char.c) && isRTL(char2.c);
      sp = rtl ? (char.rect[0] - char2.rect[2]) : getSpaceBetweenChars(char, char2);
      if (sp > wordSp || sp < -char.fontSize) {
        wordSpaces.push(j);
        wordBreaks.push(j);
        spaces.push({index: j, width: sp});
        continue;
      }

      let punctuation = '?.,;!¡¿。、·(){}[]/$:';

      if (
        //char.fontName !== char2.fontName // Can't use this because the same
        // word can have a bit different subuversion for international characters
        // Math.abs(char.fontSize - char2.fontSize) > 0.01
        Math.abs(char.baseline - char2.baseline) > 0.01
        || punctuation.includes(char.c) || punctuation.includes(char2.c)
      ) {
        wordBreaks.push(j);
      }
    }
    if (to < chars.length - 1) {
      wordBreaks.push(to + 1);
    }
  }

  let lineSpacings = [];
  for (let i = 1; i < lineBreaks.length - 1; i++) {
    let previousBreak = lineBreaks[i - 1];
    let currentBreak = lineBreaks[i];
    let nextBreak = lineBreaks[i + 1];
    let currentLineBottom = getLineBottom(chars, previousBreak, currentBreak - 1);
    let nextLineTop = getLineTop(chars, currentBreak, nextBreak - 1);
    lineSpacings.push(currentLineBottom - nextLineTop);
  }

  let lineHeights = [];
  for (let i = 1; i < lineBreaks.length; i++) {
    let previousBreak = lineBreaks[i - 1];
    let currentBreak = lineBreaks[i];
    let lineTop = getLineTop(chars, previousBreak, currentBreak - 1);
    let lineBottom = getLineBottom(chars, previousBreak, currentBreak - 1);
    lineHeights.push(lineTop - lineBottom);
  }

  let MAX_LINE_SPACING = 5;
  let MIN_LINE_SPACING = -2;
  let MAX_LINE_SPACING_CHANGE = 2;
  let INDENT_EPS = 10;

  let isGapValid = (gap) => gap >= MIN_LINE_SPACING && gap <= MAX_LINE_SPACING;





  let paragraphBreaks = [];
  let indentedBreaks = new Set();
  for (let i = 1; i < lineBreaks.length - 1; i++) {
    let currentLine = { start: lineBreaks[i - 1], end: lineBreaks[i] - 1 };
    let nextLine = { start: lineBreaks[i] || 0, end: lineBreaks[i + 1] - 1 };

    let currentRect = getBoundingRect(chars, lineBreaks[i - 1], lineBreaks[i] - 1);
    let nextRect = getBoundingRect(chars, lineBreaks[i], lineBreaks[i + 1] - 1);

    let currentLineSpacing = lineSpacings[i - 1];
    let nextLineSpacing = lineSpacings[i];

    let currentLineHeight = lineHeights[i - 1];
    let nextLineHeight = lineHeights[i];

    let allowGap = false;

    if (isGapValid(currentLineSpacing) && !isGapValid(nextLineSpacing)) {
      allowGap = true;
    }
    else if (isGapValid(currentLineSpacing) && isGapValid(nextLineSpacing)) {
      if (Math.abs(currentLineSpacing - nextLineSpacing) < MAX_LINE_SPACING_CHANGE) {
        allowGap = true;
      }
      else if (currentLineSpacing < nextLineSpacing) {
        allowGap = true;
      }
    }

    let currentLineFontName = mostCommonFontName(chars.slice(currentLine.start, currentLine.end));
    let nextLineFontName = mostCommonFontName(chars.slice(nextLine.start, nextLine.end));

    let rotation = chars[currentLine.start].rotation;
    let isIndented = (
      rotation === 0 && nextRect[0] > currentRect[0] + INDENT_EPS
      || rotation === 90 && nextRect[1] > currentRect[1] + INDENT_EPS
      || rotation === 180 && currentRect[2] > nextRect[2] + INDENT_EPS
      || rotation === 270 && currentRect[3] > nextRect[3] + INDENT_EPS
    );

    if (
      // The lines shouldn't be in the same row
      !allowGap
      || !(currentRect[1] > nextRect[3])
      || currentLineFontName !== nextLineFontName && currentRect[2] < nextRect[2] - 10
      || Math.abs(currentLineHeight - nextLineHeight) > 2
      // Next line is indented relative to the current line
      || isIndented) {
      paragraphBreaks.push(lineBreaks[i]);
      if (isIndented) {
        indentedBreaks.add(lineBreaks[i]);
      }
    }
  }

  paragraphBreaks.push(chars.length);

  // Merge single-line paragraphs back into the previous paragraph
  // when they share the same font, to prevent over-splitting.
  // Skip breaks triggered by indentation, as those are intentional.
  let paragraphStarts = [0];
  for (let pb of paragraphBreaks) {
    if (pb < chars.length) {
      paragraphStarts.push(pb);
    }
  }
  let removedBreaks = new Set();
  for (let p = 1; p < paragraphStarts.length; p++) {
    let currentStart = paragraphStarts[p];
    if (indentedBreaks.has(currentStart)) {
      continue;
    }
    let currentEnd = (p + 1 < paragraphStarts.length) ? paragraphStarts[p + 1] : chars.length;
    // Count lines in this paragraph
    let lineCount = 0;
    for (let lb of lineBreaks) {
      if (lb >= currentStart && lb < currentEnd) {
        lineCount++;
      }
    }
    if (lineCount === 1
      && chars[currentStart].fontName === chars[paragraphStarts[p - 1]].fontName) {
      removedBreaks.add(currentStart);
    }
  }
  paragraphBreaks = paragraphBreaks.filter(pb => !removedBreaks.has(pb));

  for (let paragraphBreak of paragraphBreaks) {
    chars[paragraphBreak - 1].paragraphBreakAfter = true;
  }

  for (let i = 1; i < lineBreaks.length; i++) {
    let lineStart = lineBreaks[i - 1];
    let lineEnd = lineBreaks[i] - 1;
    chars[lineEnd].lineBreakAfter = true;

    let lineRect = getBoundingRect(chars, lineStart, lineEnd);
    let vertical = [90, 270].includes(chars[lineStart].rotation);
    for (let j = lineStart; j <= lineEnd; j++) {
      let char = chars[j];
      char.inlineRect = char.rect.slice();
      if (vertical) {
        char.inlineRect[0] = lineRect[0];
        char.inlineRect[2] = lineRect[2];
      } else {
        char.inlineRect[1] = lineRect[1];
        char.inlineRect[3] = lineRect[3];
      }
    }
  }

  for (let wordBreak of wordBreaks) {
    chars[wordBreak - 1].wordBreakAfter = true;
  }

  for (let wordSpace of wordSpaces) {
    chars[wordSpace - 1].spaceAfter = true;
  }

  for (let char of chars) {
    // OCRed PDFs sometimes result in each line being a separate paragraph
    // while, normal PDFs only need this when paragraph is wrapped to another column
    if (char.lineBreakAfter /*&& !char.paragraphBreakAfter*/ && dashChars.has(char.c)) {
      char.ignorable = true;
    }
  }

  return chars;
}

function getTextFromChars(chars) {
  let text = [];
  for (let char of chars) {
    if (!char.ignorable) {
      text.push(char.c);
    }
    if (char.spaceAfter || char.lineBreakAfter && !char.paragraphBreakAfter) {
      text.push(' ');
    }
    if (char.paragraphBreakAfter) {
      text.push('\n\n');
    }
  }
  return text.join('').trim();
}

export function getStructuredChars(chars) {
  let chars2 = [];
  let fingerprints = new Set();
  for (let char of chars) {
    // Some PDF files have their text layer characters repeated many times, therefore deduplicate chars
    let fingerprint = char.c + char.rect.join('');
    if (!fingerprints.has(fingerprint)) {
      fingerprints.add(fingerprint);
      chars2.push(char);
    }
  }
  let structuredChars = split(chars2);
  for (let i = 0; i < structuredChars.length; i++) {
    structuredChars[i].offset = i;
  }

  return structuredChars;
}
