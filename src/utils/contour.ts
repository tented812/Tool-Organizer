import type { Point, ToolOutline } from "../types";

/**
 * Extract the outline contour of a tool from a photograph.
 *
 * Pipeline:
 *  1. Draw image to an off-screen canvas
 *  2. Convert to grayscale
 *  3. Threshold to binary (Otsu-style adaptive)
 *  4. Find the outer contour using Moore neighborhood tracing
 *  5. Simplify with Ramer-Douglas-Peucker
 *  6. Scale from pixels to inches using the provided calibration
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

/** Convert RGBA image data to a grayscale Uint8Array */
function toGrayscale(imageData: ImageData): Uint8Array {
  const gray = new Uint8Array(imageData.width * imageData.height);
  const d = imageData.data;
  for (let i = 0; i < gray.length; i++) {
    const off = i * 4;
    gray[i] = Math.round(0.299 * d[off] + 0.587 * d[off + 1] + 0.114 * d[off + 2]);
  }
  return gray;
}

/** Compute Otsu's threshold */
function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 0;

  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = i;
    }
  }
  return threshold;
}

/** Threshold grayscale to binary (1 = foreground tool, 0 = background) */
function toBinary(gray: Uint8Array, w: number, h: number): Uint8Array {
  const thresh = otsuThreshold(gray);
  const binary = new Uint8Array(w * h);

  // Determine if the tool is darker or lighter than background.
  // Check border pixels — they're most likely background.
  let borderSum = 0;
  let borderCount = 0;
  for (let x = 0; x < w; x++) {
    borderSum += gray[x];
    borderSum += gray[(h - 1) * w + x];
    borderCount += 2;
  }
  for (let y = 1; y < h - 1; y++) {
    borderSum += gray[y * w];
    borderSum += gray[y * w + w - 1];
    borderCount += 2;
  }
  const borderMean = borderSum / borderCount;

  // If border is bright, tool is dark → foreground = below threshold
  // If border is dark, tool is bright → foreground = above threshold
  const invertLogic = borderMean < thresh;

  for (let i = 0; i < gray.length; i++) {
    if (invertLogic) {
      binary[i] = gray[i] > thresh ? 1 : 0;
    } else {
      binary[i] = gray[i] < thresh ? 1 : 0;
    }
  }

  return binary;
}

/**
 * Flood-fill the border with 0 to clean up any edge noise,
 * then find the largest connected foreground region.
 */
function cleanBinary(binary: Uint8Array, w: number, h: number): Uint8Array {
  // Simple morphological close (dilate then erode) to fill small gaps
  const closed = new Uint8Array(binary);

  // Dilate
  const dilated = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (
        closed[idx] ||
        closed[idx - 1] ||
        closed[idx + 1] ||
        closed[idx - w] ||
        closed[idx + w]
      ) {
        dilated[idx] = 1;
      }
    }
  }

  // Erode
  const result = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (
        dilated[idx] &&
        dilated[idx - 1] &&
        dilated[idx + 1] &&
        dilated[idx - w] &&
        dilated[idx + w]
      ) {
        result[idx] = 1;
      }
    }
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
  let dir = 7; // start searching from up-right

  const maxIter = w * h * 2;
  for (let iter = 0; iter < maxIter; iter++) {
    contour.push({ x: cx, y: cy });

    // Search for next boundary pixel
    const searchStart = (dir + 5) % 8; // backtrack: start from dir-3 mod 8
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
 *                        Default assumes a phone photo of a tool on a surface with ~30 px/in at processing scale.
 */
export async function extractOutline(
  file: File,
  pixelsPerInch?: number
): Promise<ToolOutline> {
  const img = await loadImage(file);
  const { data: imageData, scale } = getImageData(img, 800);
  const { width: w, height: h } = imageData;

  const gray = toGrayscale(imageData);
  const binary = toBinary(gray, w, h);
  const cleaned = cleanBinary(binary, w, h);
  const rawContour = traceContour(cleaned, w, h);

  // Simplify — epsilon in pixels
  const epsilon = Math.max(w, h) * 0.005;
  const simplified = simplify(rawContour, epsilon);

  if (simplified.length < 3) {
    throw new Error("Could not extract a meaningful outline from this image.");
  }

  // Compute bounding box in pixel space
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

  // Default PPI: assume the tool is roughly 6-12 inches and takes up most of the frame
  const effectivePPI =
    pixelsPerInch != null
      ? pixelsPerInch * scale
      : Math.max(pxWidth, pxHeight) / 10; // assume longest dimension ≈ 10 inches

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
