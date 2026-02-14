import { useEffect, useRef, useCallback } from "react";
import * as fabric from "fabric";
import type { PlacedTool } from "../types";
import { BOARD_WIDTH_INCHES, BOARD_HEIGHT_INCHES } from "../types";

/** Pixels per inch on screen — controls zoom level */
const BASE_PPI = 30;

interface ToolCanvasProps {
  tools: PlacedTool[];
  onToolsChange: (tools: PlacedTool[]) => void;
  selectedToolId: string | null;
  onSelectTool: (id: string | null) => void;
}

export default function ToolCanvas({
  tools,
  onToolsChange,
  selectedToolId,
  onSelectTool,
}: ToolCanvasProps) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const toolsRef = useRef(tools);
  const suppressSync = useRef(false);

  toolsRef.current = tools;

  // Get current PPI based on container width
  const getPPI = useCallback(() => {
    const container = canvasElRef.current?.parentElement;
    if (!container) return BASE_PPI;
    const containerWidth = container.clientWidth - 32; // padding
    const ppi = Math.min(BASE_PPI, containerWidth / BOARD_WIDTH_INCHES);
    return Math.max(15, ppi); // minimum 15ppi so it's usable
  }, []);

  // Initialize fabric canvas
  useEffect(() => {
    if (!canvasElRef.current) return;

    const ppi = getPPI();
    const canvasW = BOARD_WIDTH_INCHES * ppi;
    const canvasH = BOARD_HEIGHT_INCHES * ppi;

    const fc = new fabric.Canvas(canvasElRef.current, {
      width: canvasW,
      height: canvasH,
      backgroundColor: "#f5f5f0",
      selection: false,
    });

    // Draw board border
    const border = new fabric.Rect({
      left: 0,
      top: 0,
      width: canvasW,
      height: canvasH,
      fill: "transparent",
      stroke: "#333",
      strokeWidth: 2,
      selectable: false,
      evented: false,
    });
    fc.add(border);

    // Draw inch grid
    for (let x = 0; x <= BOARD_WIDTH_INCHES; x++) {
      const line = new fabric.Line([x * ppi, 0, x * ppi, canvasH], {
        stroke: x % 5 === 0 ? "#ccc" : "#e8e8e8",
        strokeWidth: x % 5 === 0 ? 1 : 0.5,
        selectable: false,
        evented: false,
      });
      fc.add(line);
    }
    for (let y = 0; y <= BOARD_HEIGHT_INCHES; y++) {
      const line = new fabric.Line([0, y * ppi, canvasW, y * ppi], {
        stroke: y % 5 === 0 ? "#ccc" : "#e8e8e8",
        strokeWidth: y % 5 === 0 ? 1 : 0.5,
        selectable: false,
        evented: false,
      });
      fc.add(line);
    }

    // Add dimension labels
    const dimLabel = new fabric.FabricText(
      `${BOARD_WIDTH_INCHES}" × ${BOARD_HEIGHT_INCHES}"`,
      {
        left: canvasW / 2,
        top: canvasH + 5,
        fontSize: 12,
        fill: "#666",
        originX: "center",
        selectable: false,
        evented: false,
      }
    );
    fc.add(dimLabel);

    fabricRef.current = fc;

    return () => {
      fc.dispose();
      fabricRef.current = null;
    };
  }, [getPPI]);

  // Sync tools to fabric objects
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc || suppressSync.current) return;

    const ppi = getPPI();

    // Remove existing tool objects (keep grid/border)
    const toRemove = fc.getObjects().filter((obj: fabric.FabricObject) => {
      return (obj as fabric.FabricObject & { _toolId?: string })._toolId != null;
    });
    toRemove.forEach((obj: fabric.FabricObject) => fc.remove(obj));

    // Add tool polygons
    for (const placed of tools) {
      const { contour } = placed.outline;
      if (contour.length < 3) continue;

      const points = contour.map((p) => ({
        x: p.x * ppi,
        y: p.y * ppi,
      }));

      const poly = new fabric.Polygon(points, {
        left: placed.x * ppi,
        top: placed.y * ppi,
        fill: selectedToolId === placed.id ? "rgba(0, 150, 255, 0.25)" : "rgba(0, 120, 200, 0.15)",
        stroke: selectedToolId === placed.id ? "#0066cc" : "#004488",
        strokeWidth: selectedToolId === placed.id ? 2 : 1.5,
        angle: placed.rotation,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        lockScalingX: true,
        lockScalingY: true,
        cornerStyle: "circle",
        cornerSize: 8,
        transparentCorners: false,
        cornerColor: "#0066cc",
        borderColor: "#0066cc",
      }) as fabric.Polygon & { _toolId?: string };

      poly._toolId = placed.id;
      fc.add(poly);
    }

    fc.renderAll();
  }, [tools, selectedToolId, getPPI]);

  // Handle fabric events
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    const ppi = getPPI();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleSelection = (e: any) => {
      const selected = e?.selected;
      if (selected && selected.length > 0) {
        const toolId = (selected[0] as fabric.FabricObject & { _toolId?: string })._toolId;
        if (toolId) onSelectTool(toolId);
      }
    };

    const handleDeselection = () => {
      onSelectTool(null);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleModified = (e: any) => {
      const target = e?.target as (fabric.FabricObject & { _toolId?: string }) | undefined;
      if (!target) return;
      const toolId = target._toolId;
      if (!toolId) return;

      const updated = toolsRef.current.map((t) => {
        if (t.id !== toolId) return t;
        return {
          ...t,
          x: (target.left ?? 0) / ppi,
          y: (target.top ?? 0) / ppi,
          rotation: target.angle ?? 0,
        };
      });

      suppressSync.current = true;
      onToolsChange(updated);
      requestAnimationFrame(() => {
        suppressSync.current = false;
      });
    };

    fc.on("selection:created", handleSelection);
    fc.on("selection:updated", handleSelection);
    fc.on("selection:cleared", handleDeselection);
    fc.on("object:modified", handleModified);

    return () => {
      fc.off("selection:created", handleSelection as any);
      fc.off("selection:updated", handleSelection as any);
      fc.off("selection:cleared", handleDeselection as any);
      fc.off("object:modified", handleModified as any);
    };
  }, [onToolsChange, onSelectTool, getPPI]);

  return (
    <div style={{ overflow: "auto", border: "1px solid #ddd", borderRadius: 8, padding: 16, background: "#fff" }}>
      <canvas ref={canvasElRef} />
    </div>
  );
}
