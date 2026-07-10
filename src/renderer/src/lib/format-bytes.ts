// Shared human-readable byte-size formatter for panel file listings —
// GraphicsPanel / YychrTab / AudioBody each used to keep a private copy.

/** "532 B" below 1 KB, else one-decimal "5.2 KB". */
export function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
}
