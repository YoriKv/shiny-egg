/**
 * Common result type for decompressors in this module.
 *
 * `srcEnd` is one past the last byte read from the compressed source. Useful
 * when the caller needs to advance a stream cursor (e.g. multi-blob streams).
 *
 * `destEnd` is one past the last byte written to the destination buffer.
 */
export interface DecompResult {
  srcEnd: number;
  destEnd: number;
}
