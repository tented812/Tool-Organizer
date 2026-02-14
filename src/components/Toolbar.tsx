import type { PlacedTool } from "../types";

interface ToolbarProps {
  tools: PlacedTool[];
  selectedToolId: string | null;
  onRotateTool: (id: string, angleDelta: number) => void;
  onExportDXF: () => void;
}

export default function Toolbar({
  tools,
  selectedToolId,
  onRotateTool,
  onExportDXF,
}: ToolbarProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "8px 0",
        flexWrap: "wrap",
      }}
    >
      <button
        disabled={!selectedToolId}
        onClick={() => selectedToolId && onRotateTool(selectedToolId, -15)}
        style={btnStyle(!selectedToolId)}
        title="Rotate 15° counter-clockwise"
      >
        Rotate -15°
      </button>
      <button
        disabled={!selectedToolId}
        onClick={() => selectedToolId && onRotateTool(selectedToolId, 15)}
        style={btnStyle(!selectedToolId)}
        title="Rotate 15° clockwise"
      >
        Rotate +15°
      </button>
      <button
        disabled={!selectedToolId}
        onClick={() => selectedToolId && onRotateTool(selectedToolId, 90)}
        style={btnStyle(!selectedToolId)}
        title="Rotate 90° clockwise"
      >
        Rotate 90°
      </button>

      <div style={{ flex: 1 }} />

      <button
        disabled={tools.length === 0}
        onClick={onExportDXF}
        style={{
          ...btnStyle(tools.length === 0),
          background: tools.length === 0 ? "#ccc" : "#0066cc",
          color: "#fff",
          fontWeight: 600,
        }}
      >
        Export DXF
      </button>
    </div>
  );
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid #ccc",
    background: disabled ? "#f0f0f0" : "#fff",
    color: disabled ? "#aaa" : "#333",
    cursor: disabled ? "default" : "pointer",
    fontSize: 13,
    transition: "all 0.15s",
  };
}
