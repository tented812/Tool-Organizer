import { useRef, useState } from "react";
import type { ToolOutline } from "../types";
import { extractOutline } from "../utils/contour";

interface ImageUploadProps {
  onOutlineExtracted: (outline: ToolOutline) => void;
}

export default function ImageUpload({ onOutlineExtracted }: ImageUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const processFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file.");
      return;
    }
    setError(null);
    setProcessing(true);
    try {
      const outline = await extractOutline(file);
      onOutlineExtracted(outline);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to process image");
    } finally {
      setProcessing(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      processFile(files[i]);
    }
  };

  return (
    <div>
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        style={{
          border: `2px dashed ${dragOver ? "#0066cc" : "#ccc"}`,
          borderRadius: 8,
          padding: "24px 16px",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? "#e8f0fe" : "#fafafa",
          transition: "all 0.2s",
        }}
      >
        {processing ? (
          <div>
            <div style={{ fontSize: 14, color: "#666" }}>Processing image...</div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#999" }}>
              Extracting tool outline
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 24, marginBottom: 8 }}>+</div>
            <div style={{ fontSize: 14, color: "#666" }}>
              Click or drag tool photos here
            </div>
            <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
              Supports JPG, PNG, WebP
            </div>
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {error && (
        <div style={{ color: "#c00", fontSize: 13, marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}
