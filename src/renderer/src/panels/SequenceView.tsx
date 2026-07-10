import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { SongTimeline, TimedNote, TimedVcmd } from '../../../preload/api'
import { hex0x } from '../lib/hex'

// Read-only piano-roll over a SongTimeline — shared by the Sequence (songs)
// and SFX Seq tabs; SFX timelines arrive in the same shape with chained
// scripts on their real voice lanes. Eight voice lanes; melodic notes as
// bars (y = pitch, auto-fit per lane), percussion as blocks on the lane's
// bottom strip, vcmds as tick marks on the lane's top strip, pattern
// boundaries as vertical lines, the loop target as an accent bracket.
// Hover reports the nearest events in a text readout below (canvas
// tooltips aren't worth the hit-tracking yet). Rendering is imperative on
// a canvas inside a horizontal scroller; muted voices draw dimmed. The
// playhead is a separate rAF-translated div (never a canvas redraw): the
// caller polls the player's sample-exact position, seconds→tick runs
// through the timeline's tempoSegments, and past the first pass the
// position wraps into the loop region.

const LANE_H = 52
const TOP_STRIP = 7 // vcmd marks
const BOTTOM_STRIP = 8 // percussion row
const LEFT_PAD = 4

interface Css {
  ink: string
  ink3: string
  line: string
  accent: string
}

function cssColors(el: HTMLElement): Css {
  const s = getComputedStyle(el)
  const v = (name: string, fallback: string): string => s.getPropertyValue(name).trim() || fallback
  return {
    ink: v('--ink', '#ddd'),
    ink3: v('--ink-3', '#888'),
    line: v('--line', '#444'),
    accent: v('--accent', '#6ac')
  }
}

export function SequenceView({
  timeline,
  muteMask,
  onToggleVoice,
  getPositionSeconds
}: {
  timeline: SongTimeline
  muteMask: number
  onToggleVoice: (voice: number) => void
  /** Poll for the player's position (seconds) — null/absent hides the
   *  playhead (song not loaded / not this song / stopped). */
  getPositionSeconds?: (() => number | null) | null
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<string | null>(null)

  const pxPerTick = useMemo(() => {
    if (timeline.totalTicks <= 0) return 1
    // Cap high enough that short one-shots (SFX, jingles) still fill a
    // readable width; long songs land well under it.
    return Math.min(12, Math.max(0.15, 9000 / timeline.totalTicks))
  }, [timeline])
  const width = Math.max(600, Math.ceil(timeline.totalTicks * pxPerTick) + LEFT_PAD * 2)
  const height = LANE_H * 8

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const css = cssColors(canvas)
    ctx.clearRect(0, 0, width, height)

    // Lane backgrounds + separators.
    for (let v = 0; v < 8; v++) {
      if (v % 2 === 1) {
        ctx.fillStyle = 'rgba(127,127,127,0.06)'
        ctx.fillRect(0, v * LANE_H, width, LANE_H)
      }
      ctx.strokeStyle = css.line
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(0, v * LANE_H + 0.5)
      ctx.lineTo(width, v * LANE_H + 0.5)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // Pattern boundaries + loop bracket.
    for (const [i, p] of timeline.patterns.entries()) {
      const x = LEFT_PAD + p.startTick * pxPerTick
      ctx.strokeStyle = css.line
      ctx.beginPath()
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, height)
      ctx.stroke()
      ctx.fillStyle = css.ink3
      ctx.font = '9px monospace'
      ctx.fillText(String(i), x + 3, 9)
    }
    if (timeline.loop) {
      const target = timeline.patterns[timeline.loop.targetPartIndex]
      if (target) {
        const x = LEFT_PAD + target.startTick * pxPerTick
        ctx.strokeStyle = css.accent
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x + 1, 0)
        ctx.lineTo(x + 1, height)
        ctx.stroke()
        ctx.lineWidth = 1
        ctx.fillStyle = css.accent
        ctx.fillText('↻', x + 4, height - 4)
      }
    }

    // Per-voice content.
    for (let v = 0; v < 8; v++) {
      const voice = timeline.voices[v]
      const laneY = v * LANE_H
      const muted = (muteMask >> v) & 1
      ctx.globalAlpha = muted ? 0.22 : 1

      // Voice label.
      ctx.fillStyle = css.ink3
      ctx.font = '9px monospace'
      ctx.fillText(`V${v + 1}`, 2, laneY + 16)

      // Pitch auto-fit for melodic bars.
      let lo = 0xc7
      let hi = 0x80
      for (const n of voice.notes) {
        if (n.kind !== 'note') continue
        if (n.note < lo) lo = n.note
        if (n.note > hi) hi = n.note
      }
      const span = Math.max(1, hi - lo)
      const areaTop = laneY + TOP_STRIP + 2
      const areaH = LANE_H - TOP_STRIP - BOTTOM_STRIP - 6

      for (const n of voice.notes) {
        const x = LEFT_PAD + n.startTick * pxPerTick
        const w = Math.max(1, n.ticks * pxPerTick - 0.5)
        if (n.kind === 'note') {
          const t = (n.note - lo) / span
          const y = areaTop + (1 - t) * (areaH - 3)
          ctx.fillStyle = css.ink
          ctx.fillRect(x, y, w, 3)
        } else {
          ctx.fillStyle = css.accent
          ctx.fillRect(x, laneY + LANE_H - BOTTOM_STRIP, Math.max(1.5, Math.min(w, 4)), BOTTOM_STRIP - 2)
        }
      }

      for (const c of voice.vcmds) {
        const x = LEFT_PAD + c.tick * pxPerTick
        ctx.fillStyle = c.op === 0xe7 ? css.accent : css.ink3
        ctx.fillRect(x, laneY + 1, 1.5, TOP_STRIP - 1)
      }
      ctx.globalAlpha = 1
    }
  }, [timeline, muteMask, pxPerTick, width, height])

  // ── playhead ──────────────────────────────────────────────────────────────
  // The player counts every generated sample, so position is exact; the
  // timeline's tempoSegments invert seconds→ticks. Past the first pass we
  // wrap into the loop region (count treated as forever — display only).
  const secondsToTick = useCallback(
    (sec: number): number => {
      const tl = timeline
      if (tl.totalTicks <= 0 || tl.seconds <= 0) return 0
      const tickToSeconds = (tick: number): number => {
        let seg = tl.tempoSegments[0]
        for (const s of tl.tempoSegments) {
          if (s.tick <= tick) seg = s
          else break
        }
        return seg.seconds + (tick - seg.tick) / seg.ticksPerSecond
      }
      let s = sec
      if (s > tl.seconds) {
        const target = tl.loop ? tl.patterns[tl.loop.targetPartIndex] : undefined
        if (target) {
          const loopStartSec = tickToSeconds(target.startTick)
          const loopSpan = tl.seconds - loopStartSec
          s = loopSpan > 0 ? loopStartSec + ((s - tl.seconds) % loopSpan) : tl.seconds
        } else {
          s = tl.seconds
        }
      }
      let seg = tl.tempoSegments[0]
      for (const c of tl.tempoSegments) {
        if (c.seconds <= s) seg = c
        else break
      }
      return Math.min(tl.totalTicks, seg.tick + (s - seg.seconds) * seg.ticksPerSecond)
    },
    [timeline]
  )

  useEffect(() => {
    const playhead = playheadRef.current
    if (!playhead) return
    if (!getPositionSeconds) {
      playhead.style.display = 'none'
      return
    }
    let raf = 0
    const step = (): void => {
      const sec = getPositionSeconds()
      // A non-looping piece (SFX one-shots, jingles) has ENDED once the
      // position passes its length — the SPC keeps "playing" silence
      // forever, so without this the playhead parks at the end and the
      // scroll-follow fights every manual scroll indefinitely.
      const ended = sec !== null && !timeline.loop && sec > timeline.seconds + 0.05
      if (sec === null || ended) {
        playhead.style.display = 'none'
      } else {
        const x = LEFT_PAD + secondsToTick(sec) * pxPerTick
        playhead.style.display = 'block'
        playhead.style.transform = `translateX(${x}px)`
        // Gentle scroll-follow: keep the playhead in view without fighting
        // small manual scrolls.
        const scroller = scrollRef.current
        if (scroller) {
          const { scrollLeft, clientWidth } = scroller
          if (x < scrollLeft + 8 || x > scrollLeft + clientWidth - 24) {
            scroller.scrollLeft = Math.max(0, x - 80)
          }
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [getPositionSeconds, secondsToTick, pxPerTick, timeline])

  const describe = useCallback(
    (tick: number, voice: number): string => {
      const v = timeline.voices[voice]
      if (!v) return ''
      const parts: string[] = [`V${voice + 1} · tick ${tick}`]
      if (timeline.totalTicks > 0) {
        const sec = (timeline.seconds * tick) / timeline.totalTicks
        parts.push(`≈${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`)
      }
      const note: TimedNote | undefined = v.notes.find(
        (n) => tick >= n.startTick && tick < n.startTick + n.ticks
      )
      if (note) {
        parts.push(
          note.kind === 'note'
            ? `note ${hex0x(note.note)} ×${note.ticks}t` +
              (note.velocity !== undefined ? ` vel ${note.velocity}` : '')
            : `perc ${note.percIndex} ×${note.ticks}t`
        )
      }
      const near: TimedVcmd[] = v.vcmds.filter((c) => Math.abs(c.tick - tick) <= 8 / pxPerTick)
      if (near.length) {
        parts.push(near.map((c) => `${c.name}(${c.args.join(',')})`).join(' · '))
      }
      return parts.join('  —  ')
    },
    [timeline, pxPerTick]
  )

  return (
    <div className="se-seq">
      <div className="se-seq__pills">
        {Array.from({ length: 8 }, (_, v) => {
          const used = timeline.voices[v]?.used
          const muted = (muteMask >> v) & 1
          return (
            <button
              key={v}
              className={`se-audio__btn se-seq__pill${muted ? ' se-seq__pill--muted' : ''}`}
              disabled={!used}
              title={used ? `Mute/unmute voice ${v + 1} (live)` : `Voice ${v + 1} is unused in this song`}
              onClick={() => onToggleVoice(v)}
            >
              {v + 1}
            </button>
          )
        })}
        <span className="se-audio__group-meta">
          {timeline.patterns.length} pattern(s) · {timeline.totalTicks} ticks ≈{' '}
          {Math.floor(timeline.seconds / 60)}:{String(Math.round(timeline.seconds) % 60).padStart(2, '0')}
          {timeline.initialTempo !== null ? ` · tempo ${timeline.initialTempo}` : ''}
          {timeline.loop ? ` · loops to pattern ${timeline.loop.targetPartIndex}` : ''}
        </span>
      </div>
      <div className="se-seq__scroll" ref={scrollRef}>
        <div className="se-seq__content">
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="se-seq__canvas"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const tick = Math.max(0, Math.round((e.clientX - rect.left - LEFT_PAD) / pxPerTick))
              const voice = Math.min(7, Math.max(0, Math.floor((e.clientY - rect.top) / LANE_H)))
              setHover(describe(tick, voice))
            }}
            onMouseLeave={() => setHover(null)}
          />
          <div className="se-seq__playhead" ref={playheadRef} />
        </div>
      </div>
      <div className="se-seq__hover">{hover ?? ' '}</div>
    </div>
  )
}
