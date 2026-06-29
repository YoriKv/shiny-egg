// Per-sprite asm-fixed render facts — ENGINE-OWNED (Phase-1 consolidation).
//
// These are determined by the cart/asm, NOT user-editable: the sprite's cel format (Format-A
// single object_data tile vs Format-B multi-tile special_chr), the OBJ palette row it settles
// to at runtime (SP4 — the runtime-recolor fix), and the animation frame it visibly rests at
// (SP3 — the cel-frame fix). They used to live in the renderer's `obj-metadata.json` and reach
// the engine over IPC (celRenderableNums / formatANums / settledPaletteRows / restFrames); per
// the "asm-fixed → engine TS" rule they now live here, beside the other asm-fixed render tables
// (DYNAMIC_BODY_SOURCES, SYNTHESIZED_CELS, PARITY_CEL_VARIANTS, …), so the engine renders a
// sprite from the cart + its own tables with no facts threaded in from the renderer.
//
// `sprite-render-facts.json` is the bake target (sprite-render-v2 trace). Keys are decimal
// sprite nums (stringified in JSON).
import facts from './sprite-render-facts.json' with { type: 'json' };

const numMap = (o: Record<string, number>): ReadonlyMap<number, number> =>
  new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

/** Sprite nums that render a Format-B (multi-tile `special_chr`) cel. */
export const CEL_B_NUMS: ReadonlySet<number> = new Set<number>(facts.celB);
/** Sprite nums that render a Format-A (single `object_data` tile; items: red coin, eggs, key…). */
export const FORMAT_A_NUMS: ReadonlySet<number> = new Set<number>(facts.celA);
/** Per-sprite settled OBJ palette row 0–7 (SP4): forces the row, replacing the `$7042` seed. */
export const SETTLED_PALETTE_ROW: ReadonlyMap<number, number> = numMap(facts.settledPaletteRow);
/** Per-sprite resting animation frame (SP3): `resolveSpriteCel` decodes this frame, not frame 0. */
export const REST_FRAME: ReadonlyMap<number, number> = numMap(facts.restFrame);
