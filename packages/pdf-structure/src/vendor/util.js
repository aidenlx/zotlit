// Pinned port of the geometry helpers the two modules above share, copied
// verbatim.
//
// Source: zotero/pdf.js `src/core/module/util.js`, pinned at
//   zotero/zotero  22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c
//   zotero/reader  132bb787937a540a09513415fd507654eb0e88f9
//   zotero/pdf.js  f57fc80d1c07e4cdc50a767ae0b500b5272123b4
//
// Upstream carries no licence header of its own. `src/core/module/` belongs to
// zotero/pdf.js, an Apache-2.0 submodule of the AGPL-3.0 zotero/reader, so the
// reader's AGPL does not reach this file and Apache-2.0 into
// AGPL-3.0-or-later is permitted.
//
// Every byte after the marker is upstream. Refresh the whole body from a newer
// checkout when the golden parity test fails; never hand-edit it.
//
// @see https://github.com/zotero/pdf.js/blob/f57fc80d1c07e4cdc50a767ae0b500b5272123b4/src/core/module/util.js
//
// === verbatim upstream copy starts here ===
export function intersectRects(r1, r2) {
  return !(
    r2[0] > r1[2]
    || r2[2] < r1[0]
    || r2[1] > r1[3]
    || r2[3] < r1[1]
  );
}

export function getCenterRect(r) {
  return [
    r[0] + (r[2] - r[0]) / 2,
    r[1] + (r[3] - r[1]) / 2,
    r[0] + (r[2] - r[0]) / 2,
    r[1] + (r[3] - r[1]) / 2
  ];
}

export function getBoundingRect(chars) {
  return [
    Math.min(...chars.map(x => x.rect[0])),
    Math.min(...chars.map(x => x.rect[1])),
    Math.max(...chars.map(x => x.rect[2])),
    Math.max(...chars.map(x => x.rect[3])),
  ];
}

export function getClosestDistance(rectA, rectB) {
  // Extracting coordinates for easier understanding
  const [Ax1, Ay1, Ax2, Ay2] = rectA;
  const [Bx1, By1, Bx2, By2] = rectB;

  // Horizontal distance
  let horizontalDistance = 0;
  if (Ax2 < Bx1) { // A is left of B
    horizontalDistance = Bx1 - Ax2;
  } else if (Bx2 < Ax1) { // B is left of A
    horizontalDistance = Ax1 - Bx2;
  }

  // Vertical distance
  let verticalDistance = 0;
  if (Ay2 < By1) { // A is above B
    verticalDistance = By1 - Ay2;
  } else if (By2 < Ay1) { // B is above A
    verticalDistance = Ay1 - By2;
  }

  // If rectangles overlap in any dimension, the distance in that dimension is 0
  // The closest distance is the maximum of the horizontal and vertical distances
  return Math.max(horizontalDistance, verticalDistance);
}

// https://stackoverflow.com/a/25456134
export function basicDeepEqual(x, y) {
  if (x === y) {
    return true;
  }
  else if ((typeof x === 'object' && x != null) && (typeof y === 'object' && y !== null)) {
    if (Object.keys(x).length !== Object.keys(y).length) {
      return false;
    }
    for (let prop in x) {
      if (y.hasOwnProperty(prop)) {
        if (!basicDeepEqual(x[prop], y[prop])) {
          return false;
        }
      }
      else {
        return false;
      }
    }
    return true;
  }
  return false;
}

export function getSortIndex(pageIndex, offset, top) {
  return [
    pageIndex.toString().slice(0, 5).padStart(5, '0'),
    offset.toString().slice(0, 6).padStart(6, '0'),
    Math.max(Math.floor(top), 0).toString().slice(0, 5).padStart(5, '0')
  ].join('|');
}

export function getRectCenter(rect) {
  const [x1, y1, x2, y2] = rect;
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;
  return [centerX, centerY];
}

export function getCharsDistance(a, b) {
  // Extract the coordinates of rectangles a and b
  const [ax1, ay1, ax2, ay2] = a.rect;
  const [bx1, by1, bx2, by2] = b.rect;

  // Calculate the shortest x distance between rectangles a and b
  let xDistance = 0;
  if (ax2 < bx1) {
    xDistance = bx1 - ax2; // a is to the left of b
  } else if (bx2 < ax1) {
    xDistance = ax1 - bx2; // b is to the left of a
  }

  // Calculate the shortest y distance between rectangles a and b
  let yDistance = 0;
  if (ay2 < by1) {
    yDistance = by1 - ay2; // a is above b
  } else if (by2 < ay1) {
    yDistance = ay1 - by2; // b is above a
  }

  // Return the Euclidean distance using Math.hypot
  return Math.hypot(xDistance, yDistance);
}

export function getRangeRects(chars, offsetStart, offsetEnd) {
  let rects = [];
  let start = offsetStart;
  for (let i = start; i <= offsetEnd; i++) {
    let char = chars[i];
    if (char.lineBreakAfter || i === offsetEnd) {
      let firstChar = chars[start];
      let lastChar = char;
      let rect = [
        firstChar.rect[0],
        firstChar.inlineRect[1],
        lastChar.rect[2],
        firstChar.inlineRect[3],
      ];
      rects.push(rect);
      start = i + 1;
    }
  }
  return rects;
}

export function getRectsFromChars(chars) {
  let lineRects = [];
  let currentLineRect = null;
  for (let char of chars) {
    if (!currentLineRect) {
      currentLineRect = char.inlineRect.slice();
    }
    currentLineRect = [
      Math.min(currentLineRect[0], char.inlineRect[0]),
      Math.min(currentLineRect[1], char.inlineRect[1]),
      Math.max(currentLineRect[2], char.inlineRect[2]),
      Math.max(currentLineRect[3], char.inlineRect[3])
    ];
    if (char.lineBreakAfter) {
      lineRects.push(currentLineRect);
      currentLineRect = null;
    }
  }
  if (currentLineRect) {
    lineRects.push(currentLineRect);
  }
  return lineRects;
}

export function getPositionFromRects(chars, pageIndex) {
  let chars1 = [];
  let chars2 = [];
  for (let char of chars) {
    if (char.pageIndex === pageIndex) {
      chars1.push(char);
    } else {
      chars2.push(char);
    }
  }
  let position = {
    pageIndex,
    rects: getRectsFromChars(chars1),
  };
  if (chars2.length) {
    position.nextPageRects = getRectsFromChars(chars2);
  }
  return position;
}

export function printOutline(items, level = 0) {
  let result = '';

  items.forEach(item => {
    // Indentation is based on the level in the hierarchy
    let indentation = '  '.repeat(level);
    result += `${indentation}${item.title}\n`;

    // If the item has items, recursively process them with incremented level
    if (item.items && item.items.length > 0) {
      result += printOutline(item.items, level + 1);
    }
  });

  if (level === 0) {
    console.log(result);
  }
  else {
    return result;
  }
}

export function getClusters(objects, property, eps) {
  if (!objects.length) {
    return [];
  }
  // Sort objects based on the specified property
  objects = objects.slice();
  objects.sort((a, b) => a[property] - b[property]);

  let clusters = [];
  let currentCluster = [objects[0]];

  for (let i = 1; i < objects.length; i++) {
    const object = objects[i];
    let min = Math.min(object[property], currentCluster[currentCluster.length - 1][property]);
    let max = Math.max(object[property], currentCluster[currentCluster.length - 1][property]);
    const distance = max - min;

    // Add to current cluster if within eps; otherwise, start a new cluster
    if (distance <= eps) {
      currentCluster.push(object);
    } else {
      clusters.push(currentCluster);
      currentCluster = [object];
    }
  }

  clusters.push(currentCluster);
  return clusters;
}

export function overlaysIntersect(overlay1, overlay2) {
  if (overlay1.position.pageIndex === overlay2.position.pageIndex) {
    for (let r1 of overlay1.position.rects) {
      for (let r2 of overlay2.position.rects) {
        if (intersectRects(r1, r2)) {
          return true;
        }
      }
    }
  }
  return false;
}

export async function getPositionFromDestination(pdfDocument, dest) {
  if (!pdfDocument || !dest || !dest.length) {
    // No PDF document available or invalid destination provided.
    return;
  }

  let destArray;

  // If the destination is a string, it's a named destination.
  // We'll need to resolve it to get the actual destination array.
  if (typeof dest === 'string') {
    try {
      destArray = await pdfDocument.pdfManager.ensureCatalog("getDestination", [dest]);
      if (!destArray) {
        // Unable to resolve named destination
        return;
      }
    } catch (e) {
      console.log(e);
      return;
    }
  } else {
    destArray = dest;
  }

  const ref = destArray[0];
  let pageIndex;
  if (ref && typeof ref === "object") {
    try {
      pageIndex = await pdfDocument.pdfManager.ensureCatalog("getPageIndex", [ref]);
    } catch (e) {
      console.log(`Error getting page index from destination "${dest}"`);
      console.error(e);
      return;
    }
  }
  else if (Number.isInteger(ref)) {
    pageIndex = ref;
    if (pageIndex < 0 || pageIndex > pdfDocument.pagesCount - 1) {
      console.error(`"${pageIndex}" is not a valid page number, for destination "${dest}"`);
      return;
    }
  }
  else {
    console.error(`Invalid destination "${dest}"`);
    return;
  }

  let { rotate, view } = await pdfDocument.getPage(pageIndex);
  let width = view[2] - view[0];
  let height = view[3] - view[1];

  const changeOrientation = rotate % 180 !== 0;
  const pageHeight = (changeOrientation ? width : height);

  let x, y;
  switch (destArray[1].name) {
    case "XYZ":
      x = destArray[2] !== null ? destArray[2] : 0;
      y = destArray[3] !== null ? destArray[3] : pageHeight;
      // No adjustment for y; use original PDF coordinates.
      break;
    case "Fit":
    case "FitB":
      // No specific x, y for Fit and FitB; the whole page is shown.
      x = 0;
      y = pageHeight;
      break;
    case "FitH":
    case "FitBH":
      y = destArray[2] !== null ? destArray[2] : pageHeight;
      x = 0; // Default x to leftmost for horizontal fitting.
      break;
    case "FitV":
    case "FitBV":
      x = destArray[2] !== null ? destArray[2] : 0;
      y = pageHeight; // Default y to topmost for vertical fitting.
      break;
    case "FitR":
      x = destArray[2] !== null ? destArray[2] : 0; // Left bound of rectangle.
      y = destArray[5] !== null ? destArray[5] : pageHeight; // Top bound of rectangle.
      // No adjustment for y; use original PDF coordinates.
      break;
    default:
      // Not a valid destination type.
      return;
  }

  x = Math.max(view[0], x);
  x = Math.min(view[2], x);

  y = Math.max(view[1], y);
  y = Math.min(view[3], y);

  return {
    pageIndex,
    rects: [[x, y, x, y]],
  };
}
