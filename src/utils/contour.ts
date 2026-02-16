import type { Point, ToolOutline } from "../types";

/**
 * Extract the outline contour of a tool from a photograph.
 *
 * Robust pipeline:
 *  1. Draw image to an off-screen canvas, scale down
 *  2. Gaussian blur to eliminate texture (wood grain, fabric, etc.)
 *  3. Multi-channel analysis: grayscale + saturation + color distance from border
 *  4. Flood fill from all border pixels to identify background
 *  5. Invert → foreground mask
 *  6. Morphological open+close to clean up
 *  7. Keep only the largest connected component
 *  8. Moore neighborhood contour tracing
 *  9. Simplify with Ramer-Douglas-Peucker
 * 10. Scale from pixels to inches
 */

/** Load an image file into an HTMLImageElement */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

/** Get RGBA pixel data from an image, scaled to maxDim for performance */
function getImageData(
  img: HTMLImageElement,
  maxDim: number = 800
): { data: ImageData; scale: number } {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h), scale };
}

/** Apply Gaussian blur to RGBA image data using the canvas built-in filter */
function blurImageData(imageData: ImageData, radius: number): ImageData {
  const { width: w, height: h } = imageData;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Draw the original image data
  ctx.putImageData(imageData, 0, 0);

  // Create a second canvas to apply blur
  const canvas2 = document.createElement("canvas");
  canvas2.width = w;
  canvas2.height = h;
  const ctx2 = canvas2.getContext("2d")!;
  ctx2.filter = `blur(${radius}px)`;
  ctx2.drawImage(canvas, 0, 0);

  return ctx2.getImageData(0, 0, w, h);
}

/** Compute average RGB color from a set of pixel indices */
function averageColor(
  data: Uint8ClampedArray,
  indices: number[]
): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0;
  for (const i of indices) {
    const off = i * 4;
    r += data[off];
    g += data[off + 1];
    b += data[off + 2];
  }
  const n = indices.length;
  return [r / n, g / n, b / n];
}

/** Compute color distance (Euclidean in RGB) for each pixel vs a reference color */
function colorDistanceMap(
  data: Uint8ClampedArray,
  pixelCount: number,
  refR: number,
  refG: number,
  refB: number
): Float32Array {
  const dist = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const off = i * 4;
    const dr = data[off] - refR;
    const dg = data[off + 1] - refG;
    const db = data[off + 2] - refB;
    dist[i] = Math.sqrt(dr * dr + dg * dg + db * db);
  }
  return dist;
}

/**
 * Flood fill from all border pixels to mark background.
 * Uses a color-distance tolerance: a pixel is "background" if its color
 * is within `tolerance` of an already-marked background neighbor.
 */
function floodFillBackground(
  imageData: ImageData,
  tolerance: number
): Uint8Array {
  const { width: w, height: h, data } = imageData;
  const n = w * h;
  const background = new Uint8Array(n); // 1 = background

  // Seed: all border pixels
  const queue: number[] = [];
  for (let x = 0; x < w; x++) {
    queue.push(x); // top row
    queue.push((h - 1) * w + x); // bottom row
    background[x] = 1;
    background[(h - 1) * w + x] = 1;
  }
  for (let y = 1; y < h - 1; y++) {
    queue.push(y * w); // left col
    queue.push(y * w + w - 1); // right col
    background[y * w] = 1;
    background[y * w + w - 1] = 1;
  }

  const tolSq = tolerance * tolerance;

  // BFS flood fill
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx - x) / w;
    const off = idx * 4;
    const r0 = data[off],
      g0 = data[off + 1],
      b0 = data[off + 2];

    // 4-connected neighbors
    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < w - 1 ? idx + 1 : -1,
      y > 0 ? idx - w : -1,
      y < h - 1 ? idx + w : -1,
    ];

    for (const ni of neighbors) {
      if (ni < 0 || background[ni]) continue;
      const noff = ni * 4;
      const dr = data[noff] - r0;
      const dg = data[noff + 1] - g0;
      const db = data[noff + 2] - b0;
      if (dr * dr + dg * dg + db * db <= tolSq) {
        background[ni] = 1;
        queue.push(ni);
      }
    }
  }

  return background;
}

/** Morphological operation with a square kernel of given radius */
function dilate(binary: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const result = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let found = false;
      for (let dy = -radius; dy <= radius && !found; dy++) {
        for (let dx = -radius; dx <= radius && !found; dx++) {
          const ny = y + dy,
            nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w && binary[ny * w + nx]) {
            found = true;
          }
        }
      }
      if (found) result[y * w + x] = 1;
    }
  }
  return result;
}

function erode(binary: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const result = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let allSet = true;
      for (let dy = -radius; dy <= radius && allSet; dy++) {
        for (let dx = -radius; dx <= radius && allSet; dx++) {
          const ny = y + dy,
            nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w || !binary[ny * w + nx]) {
            allSet = false;
          }
        }
      }
      if (allSet) result[y * w + x] = 1;
    }
  }
  return result;
}

/** Morphological close (dilate then erode) — fills small gaps */
function morphClose(binary: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  return erode(dilate(binary, w, h, radius), w, h, radius);
}

/** Morphological open (erode then dilate) — removes small noise */
function morphOpen(binary: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  return dilate(erode(binary, w, h, radius), w, h, radius);
}

/** Keep only the largest connected component (4-connected) */
function largestComponent(binary: Uint8Array, w: number, h: number): Uint8Array {
  const labels = new Int32Array(w * h);
  let currentLabel = 0;
  const componentSizes: Map<number, number> = new Map();

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!binary[idx] || labels[idx]) continue;

      currentLabel++;
      let size = 0;
      const stack = [idx];
      while (stack.length > 0) {
        const ci = stack.pop()!;
        if (labels[ci]) continue;
        labels[ci] = currentLabel;
        size++;

        const cx = ci % w;
        const cy = (ci - cx) / w;
        if (cx > 0 && binary[ci - 1] && !labels[ci - 1]) stack.push(ci - 1);
        if (cx < w - 1 && binary[ci + 1] && !labels[ci + 1]) stack.push(ci + 1);
        if (cy > 0 && binary[ci - w] && !labels[ci - w]) stack.push(ci - w);
        if (cy < h - 1 && binary[ci + w] && !labels[ci + w]) stack.push(ci + w);
      }
      componentSizes.set(currentLabel, size);
    }
  }

  // Find the largest
  let bestLabel = 0;
  let bestSize = 0;
  for (const [label, size] of componentSizes) {
    if (size > bestSize) {
      bestSize = size;
      bestLabel = label;
    }
  }

  const result = new Uint8Array(w * h);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === bestLabel) result[i] = 1;
  }
  return result;
}

/** Moore neighborhood contour tracing (clockwise) */
function traceContour(binary: Uint8Array, w: number, h: number): Point[] {
  // Find first foreground pixel (scan top-left)
  let startX = -1,
    startY = -1;
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (binary[y * w + x] === 1) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  if (startX === -1) return [];

  // 8-connectivity directions: 0=right, 1=down-right, 2=down, ... 7=up-right
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  const contour: Point[] = [];
  let cx = startX,
    cy = startY;
  let dir = 7;

  const maxIter = w * h * 2;
  for (let iter = 0; iter < maxIter; iter++) {
    contour.push({ x: cx, y: cy });

    const searchStart = (dir + 5) % 8;
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (searchStart + i) % 8;
      const nx = cx + dx[d];
      const ny = cy + dy[d];
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && binary[ny * w + nx] === 1) {
        cx = nx;
        cy = ny;
        dir = d;
        found = true;
        break;
      }
    }

    if (!found) break;
    if (cx === startX && cy === startY && contour.length > 2) break;
  }

  return contour;
}

/** Perpendicular distance from point P to line segment AB */
function perpendicularDist(p: Point, a: Point, b: Point): number {
  const dxAB = b.x - a.x;
  const dyAB = b.y - a.y;
  const len = Math.sqrt(dxAB * dxAB + dyAB * dyAB);
  if (len === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  return Math.abs(dxAB * (a.y - p.y) - (a.x - p.x) * dyAB) / len;
}

/** Ramer-Douglas-Peucker polyline simplification */
function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, maxIdx + 1), epsilon);
    const right = simplify(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

/**
 * Extract a tool outline from an image file.
 * @param file - The image file to process
 * @param pixelsPerInch - Calibration: how many pixels in the original image equal 1 inch.
 *                        Default assumes longest tool dimension ≈ 10 inches.
 */
export async function extractOutline(
  file: File,
  pixelsPerInch?: number
): Promise<ToolOutline> {
  const img = await loadImage(file);
  const { data: imageData, scale } = getImageData(img, 800);
  const { width: w, height: h } = imageData;

  // Step 1: Heavy Gaussian blur to eliminate texture (wood grain, fabric, etc.)
  const blurRadius = Math.max(3, Math.round(Math.max(w, h) * 0.01));
  const blurred = blurImageData(imageData, blurRadius);

  // Step 2: Compute average border color from the blurred image
  const borderIndices: number[] = [];
  for (let x = 0; x < w; x++) {
    borderIndices.push(x);
    borderIndices.push((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    borderIndices.push(y * w);
    borderIndices.push(y * w + w - 1);
  }
  const [bgR, bgG, bgB] = averageColor(blurred.data, borderIndices);

  // Step 3: Flood fill from borders on the blurred image.
  // Try multiple tolerances and pick the one that gives the best foreground region.
  let bestForeground: Uint8Array | null = null;
  let bestScore = -1;

  for (const tol of [30, 40, 50, 60]) {
    const bg = floodFillBackground(blurred, tol);

    // Invert: foreground = !background
    const fg = new Uint8Array(w * h);
    let fgCount = 0;
    for (let i = 0; i < fg.length; i++) {
      if (!bg[i]) {
        fg[i] = 1;
        fgCount++;
      }
    }

    const totalPixels = w * h;
    const fgRatio = fgCount / totalPixels;

    // Score: foreground should be a reasonable fraction (5%-80%) of the image
    // and we want the foreground to have a meaningfully different color from background
    if (fgRatio < 0.01 || fgRatio > 0.9) continue;

    // Compute average foreground color distance from background
    let colorDist = 0;
    let cnt = 0;
    for (let i = 0; i < fg.length; i++) {
      if (fg[i]) {
        const off = i * 4;
        const dr = blurred.data[off] - bgR;
        const dg = blurred.data[off + 1] - bgG;
        const db = blurred.data[off + 2] - bgB;
        colorDist += Math.sqrt(dr * dr + dg * dg + db * db);
        cnt++;
      }
    }
    const avgDist = cnt > 0 ? colorDist / cnt : 0;

    // Prefer: reasonable foreground ratio + high color distance from background
    const score = avgDist * Math.min(fgRatio, 1 - fgRatio);
    if (score > bestScore) {
      bestScore = score;
      bestForeground = fg;
    }
  }

  if (!bestForeground) {
    // Fallback: use color distance thresholding
    const distMap = colorDistanceMap(blurred.data, w * h, bgR, bgG, bgB);
    // Find threshold via simple percentile
    const sorted = Float32Array.from(distMap).sort();
    const thresh = sorted[Math.floor(sorted.length * 0.7)];
    bestForeground = new Uint8Array(w * h);
    for (let i = 0; i < distMap.length; i++) {
      if (distMap[i] > thresh) bestForeground[i] = 1;
    }
  }

  // Step 4: Morphological cleanup
  const morphRadius = Math.max(2, Math.round(Math.max(w, h) * 0.005));
  let cleaned = morphOpen(bestForeground, w, h, morphRadius); // remove noise
  cleaned = morphClose(cleaned, w, h, morphRadius * 2); // fill gaps

  // Step 5: Keep only the largest connected component
  cleaned = largestComponent(cleaned, w, h);

  // Step 6: One more close to smooth the boundary
  cleaned = morphClose(cleaned, w, h, morphRadius);

  // Step 7: Trace contour
  const rawContour = traceContour(cleaned, w, h);

  // Step 8: Simplify
  const epsilon = Math.max(w, h) * 0.004;
  const simplified = simplify(rawContour, epsilon);

  if (simplified.length < 3) {
    throw new Error(
      "Could not extract a meaningful outline. Try a photo with better contrast between the tool and background."
    );
  }

  // Compute bounding box
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of simplified) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const pxWidth = maxX - minX;
  const pxHeight = maxY - minY;

  const effectivePPI =
    pixelsPerInch != null
      ? pixelsPerInch * scale
      : Math.max(pxWidth, pxHeight) / 10;

  const widthInches = pxWidth / effectivePPI;
  const heightInches = pxHeight / effectivePPI;

  // Normalize contour to tool-local coords in inches
  const contour: Point[] = simplified.map((p) => ({
    x: (p.x - minX) / effectivePPI,
    y: (p.y - minY) / effectivePPI,
  }));

  const name = file.name.replace(/\.[^.]+$/, "");

  return {
    id: crypto.randomUUID(),
    name,
    contour,
    widthInches,
    heightInches,
  };
}
