import React, { useRef, useState } from "react";
import { api } from "../../hooks/useApi";

type Attachment = {
  id: string;
  content_id: string;
  filename: string;
  disk_path: string;
  mime_type: string;
  size_bytes: number;
  label: string | null;
  created_at: number;
};

type Props = {
  contentId: string;
  attachments: Attachment[];
  onChanged: () => void;
};

export function PipelineAttachments({ contentId, attachments, onChanged }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        await fetch(`/api/content/${contentId}/attachments`, {
          method: "POST",
          body: formData,
        });
      }
      onChanged();
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (aid: string) => {
    try {
      await api(`/api/content/${contentId}/attachments/${aid}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  const isImage = (mime: string) => mime.startsWith("image/");

  return (
    <div>
      <h3 style={{ fontSize: "13px", fontWeight: 600, color: "var(--j-text)", marginBottom: "10px" }}>
        Attachments ({attachments.length})
      </h3>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: "16px",
          borderRadius: "8px",
          border: dragOver ? "2px dashed var(--j-accent)" : "2px dashed var(--j-border)",
          background: dragOver ? "rgba(0, 212, 255, 0.05)" : "transparent",
          textAlign: "center",
          cursor: "pointer",
          marginBottom: "10px",
          transition: "all 0.15s",
        }}
      >
        <div style={{ fontSize: "12px", color: "var(--j-text-muted)" }}>
          {uploading ? "Uploading..." : "Drop files here or click to upload"}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {/* Attachment grid */}
      {attachments.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: "8px",
        }}>
          {attachments.map((a) => (
            <div key={a.id} style={{
              position: "relative",
              borderRadius: "6px",
              border: "1px solid var(--j-border)",
              overflow: "hidden",
              background: "var(--j-surface)",
            }}>
              {isImage(a.mime_type) ? (
                <img
                  src={`/api/content/files/${a.content_id}/${a.filename}`}
                  alt={a.filename}
                  style={{
                    width: "100%",
                    height: "80px",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <div style={{
                  width: "100%",
                  height: "80px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--j-surface-hover)",
                  fontSize: "20px",
                  color: "var(--j-text-muted)",
                }}>
                  {getFileIcon(a.mime_type)}
                </div>
              )}
              <div style={{ padding: "6px 8px" }}>
                <div style={{
                  fontSize: "10px",
                  color: "var(--j-text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {a.filename}
                </div>
                <div style={{ fontSize: "9px", color: "var(--j-text-muted)" }}>
                  {formatSize(a.size_bytes)}
                </div>
              </div>
              {/* Delete button */}
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
                style={{
                  position: "absolute",
                  top: "4px",
                  right: "4px",
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  border: "none",
                  background: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  fontSize: "10px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileIcon(mime: string): string {
  if (mime.startsWith("video/")) return "\u25B6";
  if (mime.startsWith("audio/")) return "\u266B";
  if (mime.includes("pdf")) return "\u25A0";
  return "\u25C7";
}
