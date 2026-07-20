import type { JSX } from 'react'
import type { AramSegment, SettingAramUsage } from '../../../preload/api'
import { hex0x } from '../lib/hex'

// Songs-tab per-set ARAM diagram: one proportional bar over the swappable
// region (0x4000-0xFF8D) showing what the music set's uploads occupy, plus
// four gauges for the sections an imported/edited song is budgeted against
// (sequence window, custom sample window, directory slots, instrument rows).
// Data = audio:aramUsage (snes-framework aram-usage.ts; overlay-aware, so an
// imported song moves the picture without a rebuild). "Leftover" segments
// are stale title-screen bytes below later uploads' high-water mark — drawn
// dim and counted as free, since imports may overwrite them.

const REGION_START = 0x4000
const REGION_END = 0xff8e

const KIND_LABEL: Record<AramSegment['kind'], string> = {
  samples: 'sample data',
  seq: 'sequence data',
  import: 'imported song',
  leftover: 'leftover title-screen data — free for imports',
  reserved: 'plays mid-level with no reload — imports must leave it alone'
}

const fmt = (n: number): string => n.toLocaleString('en-US')

function Gauge({
  label,
  used,
  max,
  unit,
  hint
}: {
  label: string
  used: number
  max: number
  unit: string
  hint: string
}): JSX.Element {
  return (
    <div className="se-aram__gauge" title={hint}>
      <span className="se-aram__gauge-label">{label}</span>
      <span className="se-aram__gauge-track">
        <span
          className={`se-aram__gauge-fill${used >= max ? ' is-full' : ''}`}
          style={{ width: `${Math.min(100, (used / max) * 100)}%` }}
        />
      </span>
      <span className="se-aram__gauge-num">
        {fmt(used)}/{fmt(max)} {unit}
      </span>
    </div>
  )
}

export function AramUsageDiagram({ usage }: { usage: SettingAramUsage }): JSX.Element {
  const seqWindow = usage.seq.windowEnd - usage.seq.windowStart
  // The resident sample banks (the fixed $4000+ 'samples' region every song
  // leans on and imports must dodge) are the biggest, least-actionable block.
  // Collapse them into a small fixed-width chip on the LEFT so the editable
  // region — free sample space + the sequence window — gets the bar's full
  // width. `wpct` maps addresses above the banks onto the wide working bar.
  const bankSegs = usage.segments.filter((s) => s.kind === 'samples')
  const workSegs = usage.segments.filter((s) => s.kind !== 'samples')
  const bankEnd = bankSegs.reduce((m, s) => Math.max(m, s.end), REGION_START)
  const bankBytes = bankSegs.reduce((n, s) => n + (s.end - s.start), 0)
  const wpct = (addr: number): number => ((addr - bankEnd) / (REGION_END - bankEnd)) * 100
  // Sample-capable region (disjoint): the add-on window + the sequence window
  // (samples spill into its free tail) + the engine-tail gap. `budget.freeTotal`
  // is the free part; the rest is the resident add-on bank.
  const sampleRegion =
    usage.samples.customWindowSize + (usage.seq.windowEnd - usage.seq.windowStart) + (usage.low.end - usage.low.start)
  return (
    <div className="se-aram">
      <div className="se-aram__bar-row">
        {bankSegs.length > 0 && (
          <div
            className="se-aram__banks"
            title={
              `Resident sample banks — ${hex0x(REGION_START)}-${hex0x(bankEnd - 1)} · ${fmt(bankBytes)} B ` +
              '(fixed; imported songs dodge these).\n' +
              bankSegs.map((s) => `• ${s.label}: ${hex0x(s.start)}-${hex0x(s.end - 1)} (${fmt(s.end - s.start)} B)`).join('\n') +
              '\nCollapsed here so the editable region on the right shows at full scale.'
            }
          >
            {bankSegs.map((s) => (
              <div
                key={s.start}
                className="se-aram__bank-seg"
                style={{
                  left: `${((s.start - REGION_START) / (bankEnd - REGION_START)) * 100}%`,
                  width: `${((s.end - s.start) / (bankEnd - REGION_START)) * 100}%`
                }}
              />
            ))}
            <span className="se-aram__banks-tag">{Math.round(bankBytes / 1024)}K</span>
          </div>
        )}
        <div
          className="se-aram__bar"
          title={
            `Editable sound RAM ${hex0x(bankEnd)}-${hex0x(REGION_END - 1)} — free sample space + the sequence window.\n` +
            'Hover the colored spans; empty space is free for imported songs and samples.' +
            (bankSegs.length > 0
              ? `\n(${fmt(bankBytes)} B of fixed sample banks below ${hex0x(bankEnd)} are collapsed at left.)`
              : '')
          }
        >
          {workSegs.map((s) => (
            <div
              key={s.start}
              className={`se-aram__seg se-aram__seg--${s.kind}`}
              style={{ left: `${wpct(s.start)}%`, width: `${Math.max(0.3, wpct(s.end) - wpct(s.start))}%` }}
              title={`${s.label} — ${KIND_LABEL[s.kind]}\n${hex0x(s.start)}-${hex0x(s.end - 1)} · ${fmt(s.end - s.start)} B`}
            />
          ))}
          {bankEnd <= 0xd000 && (
            <div
              className="se-aram__tick"
              style={{ left: `${wpct(0xd000)}%` }}
              title={`${hex0x(0xd000)} — sequence window start (samples left, song data right)`}
            />
          )}
        </div>
      </div>
      <div className="se-aram__gauges">
        <Gauge
          label="sequence"
          used={usage.seq.used}
          max={seqWindow}
          unit="B"
          hint={
            `Song data in the ${hex0x(usage.seq.windowStart)}-${hex0x(usage.seq.windowEnd - 1)} sequence window ` +
            `(capped by the song-pointer table) — ${fmt(usage.seq.free)} B free for imported or edited songs.` +
            (usage.seq.windowStart > 0xd000
              ? `\n${hex0x(0xd000)}-${hex0x(usage.seq.windowStart - 1)} is reserved: the map keeps the Score and ` +
                'invincibility music there, and levels play them without reloading.'
              : '') +
            (usage.seq.leftover > 0
              ? `\n${fmt(usage.seq.leftover)} B of that is leftover title-screen data imports may overwrite.`
              : '') +
            (usage.seq.jingleBytes > 0
              ? `\nPlus ${fmt(usage.seq.jingleBytes)} B of jingles at ${hex0x(0x264c)} (engine-reserved overflow).`
              : '') +
            `\nImports can also claim the ${hex0x(usage.low.start)}-${hex0x(usage.low.end - 1)} gap below the sound ` +
            `driver's tables: ${fmt(usage.low.free)} B free${usage.low.used > 0 ? ` (${fmt(usage.low.used)} B in use)` : ''}.`
          }
        />
        <Gauge
          label="sample room"
          used={sampleRegion - usage.budget.freeTotal}
          max={sampleRegion}
          unit="B"
          hint={
            `Room an imported song's samples can claim — ${fmt(usage.budget.freeTotal)} B free.\n` +
            `Samples aren't capped at the ${hex0x(0xb960)}-${hex0x(0xcfff)} add-on window (${fmt(usage.samples.customWindowSize)} B); ` +
            `they first-fit that PLUS the free sequence tail and the ${hex0x(usage.low.start)}-${hex0x(usage.low.end - 1)} engine-tail gap. ` +
            `With "No echo", +${fmt(0x1000)} B more.\n` +
            `Shared with the song's sequence (one contiguous run, up to ${fmt(usage.budget.seqLargestGap)} B), so a longer song leaves less for samples.\n` +
            `Sample data resident now: ${fmt(usage.samples.used)} B across ${fmt(usage.samples.count)} samples.`
          }
        />
        <Gauge
          label="sample slots"
          used={usage.dir.used}
          max={usage.dir.max}
          unit="slots"
          hint={`Sample-directory entries claimed on the ${hex0x(0x3c00)} page — every distinct sample (instrument or SFX) needs one of the ${usage.dir.max} slots.`}
        />
        <Gauge
          label="instruments"
          used={usage.rows.used}
          max={usage.rows.max}
          unit="rows"
          hint={`Instrument-table rows uploaded at ${hex0x(0x3d00)} — ${usage.rows.max} fit before the sound driver's own code.`}
        />
      </div>
    </div>
  )
}
