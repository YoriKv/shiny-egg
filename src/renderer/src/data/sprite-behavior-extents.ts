// Behavior-extent geometry for placed sprites — the declarative table behind
// the canvas's selection-time behavior overlay (canvas/draw/sprite-behavior.ts)
// and the Properties panel's read-only "Behavior" rows. Four mark kinds:
//
//   zone   — a trigger/activation box, anchor-relative px (where the sprite
//            wakes / fires / warps when Yoshi enters it)
//   extent — a patrol/sweep segment along one axis, anchor-relative px
//   orbit  — a flight circle (radius + centre offset from the anchor)
//   snap   — the RUNTIME anchor the init moves the sprite to (ghost marker;
//            the editor draws sprites at their placed cell, the game may not)
//
import { parityOrbitWide } from './sprite-parity-variants'

// STORAGE RULE (mirrors sprite-parity-variants.ts): this module holds the
// hand-authored, asm-verified geometry; canvas/draw holds only presentation.
// Every entry cites its source. The anchor is the placed cell's top-left
// pixel (x*16, y*16) — the same anchor cel dx/dy are relative to.
//
// Entries whose geometry depends on placement parity resolve it here (the
// table values are resolver functions), so the overlay and the panel rows
// can never disagree with the parity-variant rows.

export interface BehaviorZone {
  kind: 'zone'
  label: string
  /** Box relative to the sprite anchor, px. */
  x0: number
  y0: number
  x1: number
  y1: number
  hint: string
}

export interface BehaviorExtent {
  kind: 'extent'
  label: string
  axis: 'x' | 'y'
  /** Extent from the anchor along `axis`, px (minus = toward -axis). */
  minus: number
  plus: number
  hint: string
}

export interface BehaviorOrbit {
  kind: 'orbit'
  label: string
  /** Semi-axes, px (circle when equal — the firebar sweeps an ellipse: its GSU
   *  renderer halves the Y component). */
  rx: number
  ry: number
  /** Centre offset from the anchor CENTRE (anchor + (8,8)), px. */
  cx: number
  cy: number
  hint: string
}

export interface BehaviorSnap {
  kind: 'snap'
  label: string
  /** Runtime anchor in LEVEL px (already resolved for this placement). */
  px: number
  py: number
  hint: string
}

export type BehaviorMark = BehaviorZone | BehaviorExtent | BehaviorOrbit | BehaviorSnap

/** Resolver per sprite num: placement cell coords → marks (possibly []). */
type MarkResolver = (x: number, y: number) => BehaviorMark[]

const zone = (label: string, x0: number, y0: number, x1: number, y1: number, hint: string): BehaviorZone =>
  ({ kind: 'zone', label, x0, y0, x1, y1, hint })
const extent = (label: string, axis: 'x' | 'y', minus: number, plus: number, hint: string): BehaviorExtent =>
  ({ kind: 'extent', label, axis, minus, plus, hint })
const orbit = (label: string, rx: number, ry: number, cx: number, cy: number, hint: string): BehaviorOrbit =>
  ({ kind: 'orbit', label, rx, ry, cx, cy, hint })

/** The 32px-block centre snap shared by both arrow signs (`CODE_0F89C6`:
 *  `AND #$FFE0 / ADC #$0008` on both axes). */
const snapTo32Center = (x: number, y: number, hint: string): BehaviorMark[] => {
  const px = ((x * 16) & ~0x1f) + 8
  const py = ((y * 16) & ~0x1f) + 8
  // No ghost when the snap lands on the placed anchor itself.
  if (px === x * 16 && py === y * 16) return []
  return [{ kind: 'snap', label: 'Shows at', px, py, hint }]
}

// Geometry below is verified against the asm (sweep 2026-06-11; quotes in
// research/notes-sprite-variant-candidates.md). Zone boxes mean "Yoshi's
// CENTRE inside this box" — Yoshi's centre is (PlayerX+8, PlayerY+$14) — and
// are stated anchor-relative; most checks compare the engine's sprite−Yoshi
// centre deltas ($7C16/$7C18), with the sprite centre at anchor+(8,8).
export const SPRITE_BEHAVIOR_MARKS: Record<number, MarkResolver> = {
  // ── Trigger zones ────────────────────────────────────────────────────────
  // $084 Teleport: invisible — the warp fires on the generic contact box, the
  // ONLY sprite in this set with a widened one ($7BB6/$7BB8 = $10 from the
  // FXDATA_0A9220 hitbox table; overlap adds Yoshi's 8/$0C half-extents).
  0x084: () => [zone('Warp trigger', -16, -20, 32, 36, 'Invisible in-game: warps on contact (fires for a morphed Yoshi, or normal form while airborne). Contact box from the engine hitbox table (±$18 × ±$1C around the sprite centre).')],
  // $054/$066 Wild Piranha: idle wake check CODE_05A11E (Bank05.asm:4841) —
  // both sprite−Yoshi deltas + $70 compared against $E0.
  0x054: () => [zone('Wake-up range', -104, -104, 120, 120, 'Sprouts when Yoshi enters (±$70 around the sprite centre). Also needs a free dynamic-gfx slot — it stays dormant if 4 are busy.')],
  0x066: () => [zone('Wake-up range', -104, -104, 120, 120, 'Sprouts when Yoshi enters (±$70 around the sprite centre). Also needs a free dynamic-gfx slot — it stays dormant if 4 are busy.')],
  // $190 Falling Icicle: CODE_0C8039 (Bank0C.asm:131) — X window $C0 wide,
  // Y is a half-plane (Yoshi below icicleCentre−$1F; drawn truncated).
  0x190: () => [zone('Drop trigger', -88, -24, 104, 136, 'Drops when Yoshi is inside the X window (±$60) and BELOW the icicle — the zone extends downward without limit (drawn truncated).')],
  // $036 Falling Wall: ±$30 both axes (Bank02.asm:271, inclusive edges) — but
  // the wall itself shifts ±$28 in X at spawn by which screen quadrant Yoshi
  // entered from, so the union is drawn.
  0x036: () => [zone('Drop trigger', -80, -40, 96, 56, 'Falls when Yoshi (in normal form) is within ±$30 of the wall. The wall itself shifts ±$28 left/right at spawn depending on the screen side Yoshi entered from — the box drawn is the union of both centres.')],
  // $02C Lunge Fish: submerged wake is X-only (Bank04.asm:3274, ±$80); the
  // aim/lunge phases then track Yoshi (not static).
  0x02c: () => [extent('Wake range', 'x', 128, 128, 'Wakes when Yoshi is within ±$80 horizontally — height is ignored. The aim and lunge that follow track Yoshi (fish clamped to spawn ±$10).')],
  // $1AC Small Frog: |dx|,|dy| ≤ $2F (Bank0F.asm:2481, abs-fold) — but the
  // box re-homes on the frog after every hop.
  0x1ac: () => [zone('Leap trigger', -39, -39, 55, 55, 'Leaps when Yoshi is within ±$2F of the frog. The box follows the frog — after a hop it re-centres on its new spot.')],
  // $1AA Hot Lips: X-only activation $100 wide (Bank0C.asm:7715) with a $140
  // stay-active hysteresis band (Bank0C.asm:7876).
  0x1aa: () => [
    extent('Activates', 'x', 128, 128, 'Starts rising/spraying when Yoshi is within ±$80 horizontally (height ignored).'),
    extent('Stays active', 'x', 160, 160, 'Keeps spraying until Yoshi leaves ±$A0 — the wider band is deactivation hysteresis.')
  ],
  // $04F Middle Ring: a CROSSING detector (Bank02.asm:1864) — it latches which
  // side Yoshi is on while outside, and fires when Yoshi is inside this box on
  // the OTHER side. Presence alone doesn't trigger it.
  0x04f: () => [zone('Crossing zone', -24, -21, 40, 48, 'Checkpoint fires when Yoshi passes THROUGH this zone (side-change detector with a taller keep-armed window above/below) — standing in it without crossing does nothing.')],
  // $13D Dangling Fang: drop = X band ±$80 AND Yoshi more than $20 below the
  // fang centre (Bank07.asm:6081; half-plane, drawn truncated).
  0x13d: () => [zone('Drop trigger', -120, 41, 136, 160, 'Lets go when Yoshi is inside the ±$80 X band and more than $20 BELOW the fang — extends downward without limit (drawn truncated).')],

  // ── Patrol / sweep extents ───────────────────────────────────────────────
  // $089/$08A moving platforms: init caches spawn±limit (Bank04.asm:5317/5392);
  // the main reverses at the cached bounds.
  0x089: () => [extent('Sweep', 'x', 40, 40, 'Sweeps between spawn ±$28; initial direction from the Y-cell parity (the Direction row).')],
  0x08a: () => [extent('Sweep', 'y', 32, 32, 'Sweeps between spawn ±$20; initial direction from the X-cell parity (the Direction row).')],
  // $12F/$130 Lava Drops: endpoints spawn±$30 (DATA_lava_drop_x_endpoint_offset);
  // the init repositions the drop to the FAR endpoint so it traverses the
  // whole segment first.
  0x12f: () => [extent('Patrol', 'x', 48, 48, 'Ping-pongs between spawn ±$30 (starts from the far endpoint).')],
  0x130: () => [extent('Patrol', 'y', 48, 48, 'Ping-pongs between spawn ±$30 (starts from the far endpoint).')],
  // $0AA Background Shyguy: walks anchor±$20 — but the anchor is re-derived in
  // BG2 space at spawn (camera-dependent), so this is an approximation.
  0x0aa: () => [extent('Walk range', 'x', 32, 32, 'Walks ±$20 around its anchor with random turnarounds. Approximate: the anchor is recomputed in BG2 (background-layer) space at spawn, so the in-game band can sit slightly off the placed cell.')],
  // $13F/$140 Flopsy: home = spawn X; turns at home±$20 (Bank07.asm:6467 —
  // the family doc's ±$40 was the TOTAL band width).
  0x13f: () => [extent('Swim band', 'x', 32, 32, 'Swims between spawn ±$20 (turnaround snaps to the band edge).')],
  0x140: () => [extent('Swim band', 'x', 32, 32, 'Swims between spawn ±$20 (turnaround snaps to the band edge).')],
  // $143 Spray Fish: not a patrol — its X is warped to track Yoshi, clamped to
  // spawn±$20 (Bank07.asm:7877).
  0x143: () => [extent('Tracking band', 'x', 32, 32, 'Slides within spawn ±$20 tracking Yoshi (activation is Yoshi-distance gated); leaps and sprays when Yoshi pulls ahead of the band.')],
  // $0E1 Loch Nestor: X-only sine drift, amplitude $20 (sine LUT >> 3,
  // Bank0C.asm:10738). No circle — Y stays put while drifting.
  0x0e1: () => [extent('Drift', 'x', 32, 32, 'Sine-drifts ±$20 horizontally around the spawn point (the inflate/pop cycle happens in place).')],

  // ── Orbits ───────────────────────────────────────────────────────────────
  // $1A0/$1A1 Firebar: pivot = (anchorX, anchorY+8) after the init's X−8;
  // fireballs 24px apart from offset −$48; the GSU halves the Y component, so
  // the sweep is an ELLIPSE $48 × $24. $1A0 = both arms (7 balls), $1A1 = one
  // arm (4 balls) — same swept ring.
  0x1a0: () => [orbit('Fireball sweep', 72, 36, -8, 0, 'Two arms of fireballs (24px apart) sweep this ellipse — the renderer halves the vertical throw. Spin direction from the X-cell parity (spin badge).')],
  0x1a1: () => [orbit('Fireball sweep', 72, 36, -8, 0, 'One arm of fireballs (24px apart) sweeps this ellipse — the renderer halves the vertical throw. Spin direction from the X-cell parity (spin badge).')],
  // $101/$102 Spiky Mace: true circle, outer ball at r=$4F with links at
  // 23/51px (Bank0D.asm:150); $102 adds a second arm at 180°.
  0x101: () => [orbit('Mace orbit', 79, 79, 0, 0, 'The spiked ball circles at 79px (links at 23/51px). Spin direction from the X-cell parity (spin badge).')],
  0x102: () => [orbit('Mace orbit', 79, 79, 0, 0, 'Two spiked balls circle at 79px, 180° apart (links at 23/51px). Spin direction from the X-cell parity (spin badge).')],
  // $055/$056/$064/$15E rotating clusters: the four platform CENTRES circle
  // the pivot at R6 = DATA_04C42F ($28 wide / $18 tight, fed to FXCODE_0B85D0
  // by CODE_04C433; variant index $04 set at main_four_rotating_platforms
  // Bank04.asm:8419 — $055/$15E always wide, $056 always tight, $064 by Y
  // parity). Pivot = anchor centre + (0,−8) (the shared init's Y−8 with the
  // plot path's +8 re-centre, mirroring the firebar's X−8). $064's radius is
  // resolved via parityOrbitWide so the ring can never disagree with the
  // panel's Orbit row or the spin badge's ring size.
  0x055: () => [orbit('Platform orbit', 40, 40, 0, -8, 'The four platforms (32px wide) circle this ring. Manual: spins from Yoshi\'s push; off a rail the spin free-rolls the whole cluster sideways.')],
  0x056: () => [orbit('Platform orbit', 24, 24, 0, -8, 'The four platforms (24px wide) circle this ring. Manual: spins from Yoshi\'s push; off a rail the spin free-rolls the whole cluster sideways.')],
  0x064: (x, y) => {
    const wide = parityOrbitWide(0x064, x, y)
    const r = wide ? 40 : 24
    return [orbit('Platform orbit', r, r, 0, -8, `The four platforms (${wide ? 32 : 24}px wide) circle this ring — radius from the Y-cell parity (the Orbit row). Spin direction from the X-cell parity (spin badge).`)]
  },
  0x15e: () => [orbit('Platform orbit', 40, 40, 0, -8, 'The four platforms (32px wide, each carrying a Shy Guy) circle this ring. Spin direction from the X-cell parity (spin badge).')],

  // ── Runtime snaps / generator lanes ──────────────────────────────────────
  // Arrow signs re-centre in their 32px block (init tail CODE_0F89C6,
  // Bank0F.asm:1360 — position AND #$FFE0 + 8 on both axes; the cell parity
  // is consumed as the direction selector).
  0x197: (x, y) => snapTo32Center(x, y, 'The sign re-centres itself in its 32px block at spawn — all four placements of a 2×2 cell group display here.'),
  0x198: (x, y) => snapTo32Center(x, y, 'The sign re-centres itself in its 32px block at spawn — all four placements of a 2×2 cell group display here.'),
  // Generator modes: the generator's own position is untouched, but its
  // CHILDREN spawn on a 32px-snapped lane (genCoord = pos & ~$1F stored to the
  // generator lane table). Gusty/Goonie = odd ROW generators (Y lane, children
  // enter from the screen edges); Balloon = odd COLUMN generator (X lane,
  // children rise from the bottom).
  0x0e6: (x, y) => (y & 1) === 1 && ((y * 16) & 0x1f) !== 0
    ? [{ kind: 'snap', label: 'Spawn lane', px: x * 16, py: (y * 16) & ~0x1f, hint: 'Generated Gusties enter from the screen edge at this height (the lane Y snaps to the 32px grid).' }]
    : [],
  0x0e8: (x, y) => (y & 1) === 1 && ((y * 16) & 0x1f) !== 0
    ? [{ kind: 'snap', label: 'Spawn lane', px: x * 16, py: (y * 16) & ~0x1f, hint: 'Flock Goonies respawn from the screen edge at this height (the lane Y snaps to the 32px grid).' }]
    : [],
  0x052: (x, y) => (x & 1) === 1 && ((x * 16) & 0x1f) !== 0
    ? [{ kind: 'snap', label: 'Spawn lane', px: (x * 16) & ~0x1f, py: y * 16, hint: 'Replacement balloons rise from the bottom of the screen at this column (the lane X snaps to the 32px grid).' }]
    : []
}

/** Resolved behavior marks for a placed sprite (empty for sprites without). */
export function behaviorMarks(num: number, x: number, y: number): BehaviorMark[] {
  return SPRITE_BEHAVIOR_MARKS[num]?.(x, y) ?? []
}

export interface BehaviorRow {
  label: string
  value: string
  hint: string
}

const px = (v: number): string => `${v} px`

/** Read-only Properties rows describing the marks (the panel's textual twin of
 *  the canvas overlay). */
export function behaviorRows(num: number, x: number, y: number): BehaviorRow[] {
  return behaviorMarks(num, x, y).map((m) => {
    switch (m.kind) {
      case 'zone':
        return { label: m.label, value: `${m.x1 - m.x0}×${m.y1 - m.y0} px box`, hint: m.hint }
      case 'extent':
        return {
          label: m.label,
          value: m.axis === 'x' ? `${px(m.minus)} left … ${px(m.plus)} right` : `${px(m.minus)} up … ${px(m.plus)} down`,
          hint: m.hint
        }
      case 'orbit':
        return {
          label: m.label,
          value: m.rx === m.ry ? `circle, radius ${px(m.rx)}` : `ellipse, ${px(m.rx)} × ${px(m.ry)}`,
          hint: m.hint
        }
      case 'snap':
        return { label: m.label, value: `cell (${Math.floor(m.px / 16)}, ${Math.floor(m.py / 16)})`, hint: m.hint }
    }
  })
}
