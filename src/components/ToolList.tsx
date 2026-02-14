import type { PlacedTool } from "../types";

interface ToolListProps {
  tools: PlacedTool[];
  selectedToolId: string | null;
  onSelectTool: (id: string | null) => void;
  onRemoveTool: (id: string) => void;
}

export default function ToolList({
  tools,
  selectedToolId,
  onSelectTool,
  onRemoveTool,
}: ToolListProps) {
  if (tools.length === 0) {
    return (
      <div style={{ color: "#999", fontSize: 13, fontStyle: "italic", padding: "8px 0" }}>
        No tools added yet. Upload a photo above.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {tools.map((t) => (
        <div
          key={t.id}
          onClick={() => onSelectTool(t.id === selectedToolId ? null : t.id)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 10px",
            borderRadius: 6,
            cursor: "pointer",
            background: t.id === selectedToolId ? "#e8f0fe" : "transparent",
            border: `1px solid ${t.id === selectedToolId ? "#0066cc" : "transparent"}`,
            transition: "all 0.15s",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: t.id === selectedToolId ? 600 : 400,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {t.outline.name}
            </div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
              {t.outline.widthInches.toFixed(1)}" x {t.outline.heightInches.toFixed(1)}"
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemoveTool(t.id);
            }}
            style={{
              background: "none",
              border: "none",
              color: "#c00",
              cursor: "pointer",
              fontSize: 16,
              padding: "2px 6px",
              borderRadius: 4,
              lineHeight: 1,
            }}
            title="Remove tool"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
