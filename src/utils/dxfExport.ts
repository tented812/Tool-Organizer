import type { PlacedTool } from "../types";
import { BOARD_WIDTH_INCHES, BOARD_HEIGHT_INCHES } from "../types";

// dxf-writer is a CJS module, default-exported as the Drawing class
// eslint-disable-next-line @typescript-eslint/no-require-imports
import Drawing from "dxf-writer";

/**
 * Generate a DXF string from the current board layout.
 * All coordinates are in inches. The board origin is bottom-left (DXF convention).
 */
export function generateDXF(tools: PlacedTool[]): string {
  const d = new Drawing();
  d.setUnits("Inches");

  // Add layers
  d.addLayer("Board", Drawing.ACI.WHITE, "CONTINUOUS");
  d.addLayer("Tools", Drawing.ACI.CYAN, "CONTINUOUS");

  // Draw the board outline
  d.setActiveLayer("Board");
  d.drawRect(0, 0, BOARD_WIDTH_INCHES, BOARD_HEIGHT_INCHES);

  // Draw each tool
  d.setActiveLayer("Tools");

  for (const placed of tools) {
    const { contour } = placed.outline;
    if (contour.length < 2) continue;

    const angleRad = (placed.rotation * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    // Transform contour points: rotate around tool center, then translate to board position.
    // Flip Y because the canvas has Y-down but DXF has Y-up.
    const cx = placed.outline.widthInches / 2;
    const cy = placed.outline.heightInches / 2;

    const transformed = contour.map((p) => {
      // Center the point
      const px = p.x - cx;
      const py = p.y - cy;
      // Rotate
      const rx = px * cosA - py * sinA;
      const ry = px * sinA + py * cosA;
      // Translate to board position (canvas coords → DXF coords: flip Y)
      return {
        x: placed.x + cx + rx,
        y: BOARD_HEIGHT_INCHES - (placed.y + cy + ry),
      };
    });

    // Draw as a closed polyline
    const points = transformed.map((p) => [p.x, p.y] as [number, number]);
    // Close the shape by repeating the first point
    if (points.length > 0) {
      points.push(points[0]);
    }

    // Draw individual line segments (most compatible DXF approach)
    for (let i = 0; i < points.length - 1; i++) {
      d.drawLine(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    }
  }

  return d.toDxfString();
}

/** Trigger a download of the DXF file */
export function downloadDXF(tools: PlacedTool[], filename: string = "tool-layout.dxf"): void {
  const dxfString = generateDXF(tools);
  const blob = new Blob([dxfString], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
