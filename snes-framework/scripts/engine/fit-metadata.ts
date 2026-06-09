// Fit-metadata — the universal, tileset-aware categorization the surface fitter
// resolves against, plus the runtime ThemePalette it consumes. One entry per
// numeric BG1 tileset (the level header value, 0..15): the surface-relevant std
// objects, the fit ROLE each fills, and — crucially for slopes — HOW the role is
// expressed (angle, the direction at +w, whether -w mirrors it).
//
// The data file (`fit-metadata.json`) is derived by probing decoded collision
// (research/surface-painting/gen-fit-metadata.ts), not hand-asserted. This module
// is the data's engine home + the `ThemePalette` it resolves to; the fitter
// (`surface-fit.ts`) reads `paletteForTileset()` instead of a hardcoded palette.

// Imported as a module (not fs-read) so the bundler inlines it into the main
// process — `import.meta.dirname` points at the bundle (out/main) where the file
// doesn't exist. The `with { type: 'json' }` attribute keeps it valid under Node's
// direct .ts execution too (the engine test / research harness).
import fitMetaJson from './fit-metadata.json' with { type: 'json' };

// ── metadata schema ──────────────────────────────────────────────────────────
/** Universal surface-fit role vocabulary. The first group is Layer-1 surface
 *  (what the fitter emits today); cut/hole/interiorSlope are Layer-2/3 (set
 *  aside for fitting, categorized for completeness); the rest are non-surface. */
export type FitRole =
  | 'floor'                    // flat walkable ledge — the primary surface
  | 'ground'                   // solid interior fill block a platform sits on
  | 'edgeLeft' | 'edgeRight'   // vertical end-cap of a ledge run
  | 'slope'                    // Layer-1 floor slope (solid below) — see angle/dir
  | 'ceiling'                  // overhang underside cap
  | 'wallLeft' | 'wallRight'   // clean vertical wall column
  | 'cut'                      // cross-section (Layer 2, tunnel)
  | 'hole'                     // wall hole (Layer 3)
  | 'interiorSlope'            // sloped inner edge of a cut (Layer 2)
  | 'stairs'                   // full-cell step staircase
  | 'decoration' | 'hazard' | 'water' | 'pipe' | 'collectible' | 'other';

/** Slope steepness — run:rise. gradual 2:1 (~26.5°), normal 1:1 (45°), steep 1:2 (~63.4°). */
export type SlopeAngle = 'gradual' | 'normal' | 'steep';
export type SlopeDir = 'downRight' | 'downLeft';

/** One std object's fit categorization within a tileset. */
export interface ObjectFitMeta {
  id: number;
  name: string;                // from obj-metadata
  category: string;            // obj-metadata category (terrain/slope/...)
  role: FitRole;
  angle?: SlopeAngle;          // slope-only
  dir?: SlopeDir;              // surface direction when w >= 0
  mirrorBySign?: boolean;      // negative w renders the OPPOSITE direction
  measured?: string;           // measured run:rise, for traceability
}

/** How the fitter expresses one slope angle in a tileset. A down-left slope is
 *  emitted as `downLeft` at +w when a dedicated id exists (cave idiom), else as
 *  `downRight` at -w (flower idiom — `signOnly`). */
export interface SlopeResolution {
  downRight?: number;
  downLeft?: number;
  signOnly: boolean;
}

/** The resolved fit palette for a tileset — what the fitter reads directly. */
export interface TilesetRoles {
  floor?: number;
  ground?: number;
  edgeLeft?: number;
  edgeRight?: number;
  ceiling?: number;
  wallLeft?: number;
  wallRight?: number;
  cut?: number;
  hole?: number;
  slopes: Partial<Record<SlopeAngle, SlopeResolution>>;
}

export interface TilesetFitMeta {
  tileset: number;             // BG1 tileset header value
  name: string;                // human label
  baseLevel: string;           // representative level (hex) used to derive
  levelCount: number;          // backed levels using this tileset
  objects: ObjectFitMeta[];    // surface-relevant objects, sorted by id
  roles: TilesetRoles;
}

export interface FitMetadata {
  generatedFrom: string;
  tilesets: TilesetFitMeta[];
}

// ── runtime palette (what the fitter consumes) ───────────────────────────────
/** Per-angle slope ids, optional so a tileset can declare only the slopes it has. */
export interface SlopeIds {
  /** 2:1 (~26.5°) */ gradual?: number;
  /** 1:1 (~45°)   */ normal?: number;
  /** 1:2 (~63.4°) */ steep?: number;
}

/** Semantic role → concrete std id for one tileset. */
export interface ThemePalette {
  floor: number;
  /** solid base terrain a raised platform sits on (e.g. 0x67) — fills below the
   *  platform from the ground top to baseline; the platform's objects stop at it. */
  ground?: number;
  edgeLeft: number;
  edgeRight: number;
  /** single-row ceiling-underside tile (0x58) */
  ceiling: number;
  /** clean vertical wall columns (no grass lip): face-left / face-right */
  wallLeft: number;
  wallRight: number;
  /** down-right floor slopes (surface descends as x increases) */
  slopeDownRight: SlopeIds;
  /** down-left floor slopes (descends as x decreases). The id assigned here is
   *  the visually-correct one for a left/ascending slope; the fitter probes its
   *  actual +w collision direction and flips the width sign when needed (some
   *  tilesets — flower garden — only descend-left at NEGATIVE w). So this need
   *  not be a "+w down-left" id; whatever is here is emitted at the sign that
   *  reproduces a down-left surface. */
  slopeDownLeft: SlopeIds;
  /** @deprecated The forward fitter now derives the width sign by probing the
   *  footprint (surface-fit.ts `resolveSlope`); this flag is no longer read. */
  mirrorBySign?: boolean;
  cut: number;
  hole: number;
}

/** Cave/grass default palette — the fallback for tilesets the metadata omits. */
export const CAVE_GRASS: ThemePalette = {
  floor: 0x01,
  edgeLeft: 0x02,
  edgeRight: 0x03,
  ceiling: 0x58,
  wallLeft: 0x0a,
  wallRight: 0x0b,
  slopeDownRight: { gradual: 0x04, normal: 0x06, steep: 0x08 },
  slopeDownLeft: { gradual: 0x05, normal: 0x07, steep: 0x09 },
  cut: 0x14,
  hole: 0x7f
};

const META = fitMetaJson as unknown as FitMetadata;
/** The fit-metadata (bundled JSON). Lives beside this module. */
export function fitMetadata(): FitMetadata {
  return META;
}

/** ThemePalette for a numeric BG1 tileset, or null if the metadata has no entry.
 *  Ceiling/wall/cut/hole fall back to CAVE_GRASS for tilesets that don't declare
 *  them (not used by L1 fitting). */
export function paletteForTileset(tileset: number): ThemePalette | null {
  const t = fitMetadata().tilesets.find(x => x.tileset === tileset);
  if (!t) return null;
  const r = t.roles;
  const slopeDownRight: SlopeIds = {}, slopeDownLeft: SlopeIds = {};
  let mirrorBySign = false;
  for (const a of ['gradual', 'normal', 'steep'] as SlopeAngle[]) {
    const s = r.slopes[a]; if (!s) continue;
    if (s.downRight != null) slopeDownRight[a] = s.downRight;
    if (s.downLeft != null) slopeDownLeft[a] = s.downLeft;
    else if (s.signOnly && s.downRight != null) { slopeDownLeft[a] = s.downRight; mirrorBySign = true; }
  }
  return {
    floor: r.floor ?? CAVE_GRASS.floor,
    ground: r.ground,
    edgeLeft: r.edgeLeft ?? CAVE_GRASS.edgeLeft,
    edgeRight: r.edgeRight ?? CAVE_GRASS.edgeRight,
    ceiling: r.ceiling ?? CAVE_GRASS.ceiling,
    wallLeft: r.wallLeft ?? CAVE_GRASS.wallLeft,
    wallRight: r.wallRight ?? CAVE_GRASS.wallRight,
    slopeDownRight, slopeDownLeft, mirrorBySign,
    cut: r.cut ?? CAVE_GRASS.cut,
    hole: r.hole ?? CAVE_GRASS.hole
  };
}

export const tilesetName = (tileset: number): string =>
  fitMetadata().tilesets.find(x => x.tileset === tileset)?.name ?? `tileset ${tileset}`;
