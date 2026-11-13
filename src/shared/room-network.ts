export interface RoomWarpDestination {
  destLevelRecordId: number
  destX: number
  destY: number
  entranceType: number
}
export interface WarpOrigin {
  sourceLevelRecordId: number
  sourceScreenIndex: number
  kind?: 'rotating-door'
  sourceSpriteIndex?: number
  doorIndex?: number
}
/** Screen exits use their screen; sprite-generated exits also need door identity. */
export function incomingIdentity(origin: WarpOrigin): string {
  const base = `${origin.sourceLevelRecordId}:${origin.sourceScreenIndex}`
  return origin.kind === 'rotating-door' ? `${base}:door:${origin.sourceSpriteIndex}:${origin.doorIndex}` : base
}
