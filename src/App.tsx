import { useState, useCallback } from "react";
import type { ToolOutline, PlacedTool } from "./types";
import { BOARD_WIDTH_INCHES, BOARD_HEIGHT_INCHES } from "./types";
import ImageUpload from "./components/ImageUpload";
import ToolCanvas from "./components/ToolCanvas";
import ToolList from "./components/ToolList";
import Toolbar from "./components/Toolbar";
import { downloadDXF } from "./utils/dxfExport";

export default function App() {
  const [tools, setTools] = useState<PlacedTool[]>([]);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);

  const handleOutlineExtracted = useCallback(
    (outline: ToolOutline) => {
      // Auto-place: find the first open position (simple left-to-right, top-to-bottom packing)
      let bestX = 0;
      let bestY = 0;

      // Simple placement: try to fit after existing tools
      if (tools.length > 0) {
        // Place to the right of the rightmost tool, or wrap to next row
        const lastTool = tools[tools.length - 1];
        bestX = lastTool.x + lastTool.outline.widthInches + 0.5;
        bestY = lastTool.y;

        if (bestX + outline.widthInches > BOARD_WIDTH_INCHES) {
          bestX = 0;
          // Find the lowest point of any tool in the current "row"
          let maxBottom = 0;
          for (const t of tools) {
            const bottom = t.y + t.outline.heightInches;
            if (bottom > maxBottom) maxBottom = bottom;
          }
          bestY = maxBottom + 0.5;
        }

        if (bestY + outline.heightInches > BOARD_HEIGHT_INCHES) {
          // Board is full, just stack at 0,0
          bestX = 0;
          bestY = 0;
        }
      }

      const placed: PlacedTool = {
        id: outline.id,
        outline,
        x: bestX,
        y: bestY,
        rotation: 0,
      };

      setTools((prev) => [...prev, placed]);
    },
    [tools]
  );

  const handleRotateTool = useCallback((id: string, angleDelta: number) => {
    setTools((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, rotation: (t.rotation + angleDelta) % 360 } : t
      )
    );
  }, []);

  const handleRemoveTool = useCallback(
    (id: string) => {
      setTools((prev) => prev.filter((t) => t.id !== id));
      if (selectedToolId === id) setSelectedToolId(null);
    },
    [selectedToolId]
  );

  const handleExportDXF = useCallback(() => {
    downloadDXF(tools);
  }, [tools]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <header
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #e0e0e0",
          background: "#fff",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#222" }}>
          Tool Organizer
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#888" }}>
          Upload tool photos, arrange outlines on a {BOARD_WIDTH_INCHES}" x{" "}
          {BOARD_HEIGHT_INCHES}" board, and export as DXF
        </p>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        <aside
          style={{
            width: 260,
            borderRight: "1px solid #e0e0e0",
            padding: 16,
            overflowY: "auto",
            background: "#fafafa",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px", color: "#444" }}>
              Add Tool
            </h2>
            <ImageUpload onOutlineExtracted={handleOutlineExtracted} />
          </div>

          <div>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px", color: "#444" }}>
              Tools ({tools.length})
            </h2>
            <ToolList
              tools={tools}
              selectedToolId={selectedToolId}
              onSelectTool={setSelectedToolId}
              onRemoveTool={handleRemoveTool}
            />
          </div>
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "8px 16px" }}>
            <Toolbar
              tools={tools}
              selectedToolId={selectedToolId}
              onRotateTool={handleRotateTool}
              onExportDXF={handleExportDXF}
            />
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px" }}>
            <ToolCanvas
              tools={tools}
              onToolsChange={setTools}
              selectedToolId={selectedToolId}
              onSelectTool={setSelectedToolId}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
