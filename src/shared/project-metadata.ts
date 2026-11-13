/** Editor-only project data. Stored beside project.json, never in ROM overlays.
 * Unknown fields are preserved so additional metadata can be introduced later. */
export interface RoomMetadata {
  name?: string
  notes?: string
  [key: string]: unknown
}

export interface ProjectEditorMetadata {
  version: 1
  rooms: Record<string, RoomMetadata>
  [key: string]: unknown
}

export type RoomMetadataPatch = Pick<RoomMetadata, 'name' | 'notes'>
