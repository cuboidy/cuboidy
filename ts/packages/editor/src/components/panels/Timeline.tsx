import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { formatTimeKey, type AnimationTrack, type EasingName, type InlineAnimation, type KeyAttr } from '@cuboidy/core';
import type { SelectedKey } from '@cuboidy/ui';

// Width (px) of the left label gutter. Single-sourced here and fed to both
// the gutter elements and the playhead's horizontal offset so the playhead
// lines up with the lanes without measuring the DOM.
const LABEL_W = 96;

// Right inset (px) shared by the ruler, every lane, and the playhead math.
// Two jobs: keeps a marker at frac=1 (a key exactly at duration) fully
// visible instead of half-clipped by overflow-x, and keeps it clear of
// Windows 11's overlay scrollbar, which paints on top of the content's
// right edge.
const RIGHT_PAD = 14;

// One step of the canonical time grid (formatTimeKey rounds to 1e-3).
// Neighbor clamps keep a full grid step of clearance, which strictly exceeds
// nearestExistingKey's eps (5e-4), so a clamped drag can never silently merge
// into a same-attribute neighbor.
const GRID = 0.001;

// Pointer must travel this far (px) before a press becomes a drag, so plain
// clicks never mint an accidental micro-move.
const DRAG_SLOP_PX = 3;

const ZERO_KEY = formatTimeKey(0); // "0.0"

const ATTRS: ReadonlyArray<{ key: KeyAttr; label: string }> = [
  { key: 'rot', label: 'rot' },
  { key: 'pos', label: 'pos' },
  { key: 'scale', label: 'scale' },
  { key: 'visible', label: 'vis' },
];

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const snap = (t: number): number => Math.round(t * 1000) / 1000;

// Coarse snap grid for dragging keyframes — markers land on 0.05s steps so a
// drag reads as deliberate "clicks" instead of free-floating. Holding Alt
// bypasses to the fine 1e-3 grid (formatTimeKey's storage resolution).
export const SNAP_STEP = 0.05;
const snapTo = (t: number, step: number): number => Math.round(t / step) * step;

// Ruler tick / lane gridline spacing: a "nice" step (1/2/2.5/5 ×10ⁿ) chosen so
// ~8 labelled ticks span the clip — makes the grid the keyframes snap onto
// actually visible (the seed concern was "drag doesn't feel snapped").
function gridStep(duration: number): number {
  if (duration <= 0) return 0;
  const rough = duration / 8;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const m of [1, 2, 2.5, 5]) {
    if (m * pow >= rough) return m * pow;
  }
  return 10 * pow;
}

const fmtTick = (t: number): string => `${Number(t.toFixed(3))}`;

interface Marker {
  t: number;
  timeKey: string;
}

// Time-keys (sorted) whose keyframe carries `attr` — the per-attribute lane's
// markers, derived from the sparse Keyframe map. `attr === null` returns ALL
// time-keys (every entry carries ≥1 attribute) — the collapsed summary lane.
function markerTimes(
  track: AnimationTrack | undefined,
  attr: KeyAttr | null,
): Marker[] {
  if (track === undefined) return [];
  return Object.keys(track)
    .filter((k) => attr === null || attr in track[k]!)
    .map((k) => ({ t: Number(k), timeKey: k }))
    .filter((m) => Number.isFinite(m.t))
    .sort((a, b) => a.t - b.t);
}

interface PartMarkers {
  rot: Marker[];
  pos: Marker[];
  scale: Marker[];
  visible: Marker[];
  all: Marker[];
}

interface Props {
  partNames: readonly string[];
  inline: InlineAnimation;
  // Active clip name. Used as TimelineLanes' key so a clip switch remounts
  // the lanes and re-derives the expand/collapse defaults.
  clipName: string;
  time: number;
  selectedKey: SelectedKey | null;
  disabled: boolean;
  onScrub: (t: number) => void;
  onSelectKey: (k: SelectedKey) => void;
  onAddKey: (part: string, attr: KeyAttr) => void;
  onMoveKey: (
    part: string,
    attr: KeyAttr,
    fromTimeKey: string,
    toTime: number,
  ) => void;
  onClearPart: (part: string) => void;
}

// Premiere/AE-style timeline: one row per model part, each expanded into
// rot/pos/scale/visible lanes. The playhead overlay is the only thing that
// depends on `time`, so the marker grid (TimelineLanes) is memoized and
// skips re-render during playback; a marker drag re-renders only that one
// marker (local state) plus the playhead.
//
// Layout: the ruler (sticky), the lanes, and the playhead ALL live inside
// the vertical scroll container's content, so they share one coordinate
// space whose width already excludes the scrollbar — the playhead lines up
// with the markers regardless of whether the scrollbar is present. (The
// previous layout positioned the playhead against the full panel width and
// kept the ruler outside the scroller, so everything drifted right of the
// lanes once the scrollbar appeared.)
export function Timeline({
  partNames,
  inline,
  clipName,
  time,
  selectedKey,
  disabled,
  onScrub,
  onSelectKey,
  onAddKey,
  onMoveKey,
  onClearPart,
}: Props) {
  const duration = inline.duration;

  const scrubFromEvent = (e: PointerEvent<HTMLDivElement>): void => {
    if (duration <= 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    onScrub(clamp01((e.clientX - r.left) / r.width) * duration);
  };
  // Pointer capture makes the ruler scrub by drag, not just click — the
  // playhead follows the pointer until release even if it leaves the strip.
  const handleRulerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubFromEvent(e);
  };
  const handleRulerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubFromEvent(e);
  };

  const headFrac = duration > 0 ? clamp01(time / duration) : 0;

  // Labelled major ticks across the clip (same step as the lane gridlines).
  const majorStep = gridStep(duration);
  const ticks: number[] = [];
  if (majorStep > 0 && duration > 0) {
    for (let i = 0; i * majorStep <= duration + 1e-9; i++) {
      ticks.push(snap(i * majorStep));
    }
  }

  return (
    <div className="timeline">
      <div className="timeline-scroll">
        <div className="timeline-inner">
          <div className="timeline-ruler-row">
            <div className="timeline-gutter" style={{ width: LABEL_W }} />
            <div
              className="timeline-ruler"
              style={{ marginRight: RIGHT_PAD }}
              onPointerDown={handleRulerDown}
              onPointerMove={handleRulerMove}
            >
              {ticks.map((tt) => {
                const f = tt / duration;
                // Anchor edge labels inward so they don't clip past the ruler.
                const anchor = f < 0.04 ? '0' : f > 0.96 ? '-100%' : '-50%';
                return (
                  <div
                    key={tt}
                    className="timeline-tick"
                    style={{ left: `${f * 100}%` }}
                  >
                    <span
                      className="timeline-tick-label"
                      style={{ transform: `translateX(${anchor})` }}
                    >
                      {fmtTick(tt)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <TimelineLanes
            key={clipName}
            partNames={partNames}
            inline={inline}
            selectedKey={selectedKey}
            disabled={disabled}
            onSelectKey={onSelectKey}
            onAddKey={onAddKey}
            onMoveKey={onMoveKey}
            onScrub={onScrub}
            onClearPart={onClearPart}
          />
          {/* Offset LABEL_W + a fraction of the lane width (container minus
              gutter minus right inset) so the playhead tracks the markers. */}
          <div
            className="timeline-playhead"
            style={{
              left: `calc(${LABEL_W}px + (100% - ${LABEL_W + RIGHT_PAD}px) * ${headFrac})`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

interface LanesProps {
  partNames: readonly string[];
  inline: InlineAnimation;
  selectedKey: SelectedKey | null;
  disabled: boolean;
  onSelectKey: (k: SelectedKey) => void;
  onAddKey: (part: string, attr: KeyAttr) => void;
  onMoveKey: (
    part: string,
    attr: KeyAttr,
    fromTimeKey: string,
    toTime: number,
  ) => void;
  onScrub: (t: number) => void;
  onClearPart: (part: string) => void;
}

const TimelineLanes = memo(function TimelineLanes({
  partNames,
  inline,
  selectedKey,
  disabled,
  onSelectKey,
  onAddKey,
  onMoveKey,
  onScrub,
  onClearPart,
}: LanesProps) {
  const duration = inline.duration;

  // Lane gridlines: a major line per `gridStep` (matching the ruler ticks) and
  // a fainter minor line per snap step, the minor only when sparse enough to
  // stay legible. Exposed as CSS vars (fraction of the lane width) consumed by
  // the .timeline-lane background gradient. Fall back to 1 (= a line only at
  // the far edge, i.e. none) when there's no usable grid.
  const majorStep = gridStep(duration);
  const gridFrac = duration > 0 && majorStep > 0 ? majorStep / duration : 0;
  const snapFrac = duration > 0 && duration <= 2 ? SNAP_STEP / duration : 0;
  const gridStyle = {
    '--grid-frac': gridFrac > 0 ? gridFrac : 1,
    '--snap-frac': snapFrac > 0 ? snapFrac : 1,
  } as CSSProperties;

  // Per-part expand/collapse. Default: parts WITH a track in this clip start
  // expanded, keyless parts collapse to one header line. An explicit set
  // (not deviations-from-default) so adding a first key to a manually
  // expanded part doesn't snap it shut. The parent keys this component by
  // clip name, so a clip switch remounts and re-derives the defaults.
  const [expandedParts, setExpandedParts] = useState<ReadonlySet<string>>(() => {
    const withTrack = partNames.filter((p) => inline.parts[p] !== undefined);
    // Empty clip (no part has a track yet): expand the first part so its + add
    // buttons are reachable — otherwise every row is collapsed and there is no
    // visible way to drop the first keyframe.
    return new Set(withTrack.length > 0 ? withTrack : partNames.slice(0, 1));
  });
  const togglePart = (part: string): void => {
    setExpandedParts((prev) => {
      const next = new Set(prev);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  };

  // Click/drag on empty lane space scrubs the playhead (mirrors the ruler).
  // Presses that land on a marker are a select/drag instead — identified by
  // target !== the lane itself — so they're ignored here.
  const laneScrub = (e: PointerEvent<HTMLDivElement>): void => {
    if (duration <= 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    onScrub(clamp01((e.clientX - r.left) / r.width) * duration);
  };
  const handleLaneDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    laneScrub(e);
  };
  const handleLaneMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) laneScrub(e);
  };

  // Markers depend only on the animation data, not on `time`. Recomputed
  // when a key is added/edited/deleted/moved (inline changes), never on
  // playback. `all` is the union across attributes — the collapsed summary.
  const markers = useMemo(() => {
    const m = new Map<string, PartMarkers>();
    for (const part of partNames) {
      const track = inline.parts[part];
      m.set(part, {
        rot: markerTimes(track, 'rot'),
        pos: markerTimes(track, 'pos'),
        scale: markerTimes(track, 'scale'),
        visible: markerTimes(track, 'visible'),
        all: markerTimes(track, null),
      });
    }
    return m;
  }, [partNames, inline]);

  return (
    <div className="timeline-body" style={gridStyle}>
      {partNames.map((part) => {
        const rec = markers.get(part);
        const hasTrack = inline.parts[part] !== undefined;
        const expanded = expandedParts.has(part);
        const keyCount = rec?.all.length ?? 0;
        return (
          <div className="timeline-part" key={part}>
            <div className="timeline-part-header">
              <div className="timeline-part-head" style={{ width: LABEL_W }}>
                {/* View state, deliberately NOT gated by `disabled` —
                    collapsing is not a manifest edit. */}
                <button
                  type="button"
                  className="timeline-part-toggle"
                  aria-expanded={expanded}
                  title={`${part} — ${keyCount} key${keyCount === 1 ? '' : 's'}`}
                  onClick={() => togglePart(part)}
                >
                  <span className="timeline-caret">
                    {expanded ? (
                      <ChevronDown size={11} />
                    ) : (
                      <ChevronRight size={11} />
                    )}
                  </span>
                  <span className="timeline-part-name">{part}</span>
                </button>
                {hasTrack && (
                  <button
                    type="button"
                    className="btn-icon timeline-part-clear"
                    disabled={disabled}
                    title={`Clear all ${part} keys in this clip`}
                    onClick={() => onClearPart(part)}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              {!expanded && (
                /* Collapsed summary: non-interactive ticks at every key time,
                   sharing the lane geometry so they align with the playhead. */
                <div
                  className="timeline-summary-lane"
                  style={{ marginRight: RIGHT_PAD }}
                >
                  {(rec?.all ?? []).map(({ t, timeKey }) => (
                    <span
                      key={timeKey}
                      className="timeline-summary-tick"
                      style={{
                        left: `${(duration > 0 ? clamp01(t / duration) : 0) * 100}%`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            {expanded &&
              ATTRS.map(({ key, label }) => {
                const arr = rec?.[key] ?? [];
                return (
                  <div className="timeline-attr-row" key={key}>
                    <div className="timeline-attr-head" style={{ width: LABEL_W }}>
                      <span className="timeline-attr-label">{label}</span>
                      <button
                        type="button"
                        className="btn-icon timeline-add"
                        title={`Add ${label} key at playhead`}
                        disabled={disabled}
                        onClick={() => onAddKey(part, key)}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <div
                      className="timeline-lane"
                      style={{ marginRight: RIGHT_PAD }}
                      onPointerDown={handleLaneDown}
                      onPointerMove={handleLaneMove}
                    >
                      {arr.map(({ t, timeKey }, i) => (
                        <TimelineMarker
                          key={timeKey}
                          part={part}
                          attr={key}
                          label={label}
                          timeKey={timeKey}
                          t={t}
                          duration={duration}
                          ease={
                            key !== 'visible'
                              ? inline.parts[part]?.[timeKey]?.ease?.[key]
                              : undefined
                          }
                          prevT={arr[i - 1]?.t ?? null}
                          nextT={arr[i + 1]?.t ?? null}
                          selected={
                            selectedKey !== null &&
                            selectedKey.part === part &&
                            selectedKey.attr === key &&
                            selectedKey.timeKey === timeKey
                          }
                          disabled={disabled}
                          onSelectKey={onSelectKey}
                          onMoveKey={onMoveKey}
                          onScrub={onScrub}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
});

interface MarkerProps {
  part: string;
  attr: KeyAttr;
  label: string;
  timeKey: string;
  t: number;
  duration: number;
  // This ATTRIBUTE's outgoing ease at this key (§6.5 per-attribute map;
  // undefined = linear). Non-linear → badge on this lane's marker only.
  ease: EasingName | undefined;
  // Sorted same-attribute neighbors — the drag clamp bounds. null at the
  // lane's edges.
  prevT: number | null;
  nextT: number | null;
  selected: boolean;
  disabled: boolean;
  onSelectKey: (k: SelectedKey) => void;
  onMoveKey: (
    part: string,
    attr: KeyAttr,
    fromTimeKey: string,
    toTime: number,
  ) => void;
  onScrub: (t: number) => void;
}

// A single draggable keyframe marker. Drag state (`dragT`) is LOCAL so a
// pointermove re-renders only this marker (plus the playhead via onScrub) —
// TimelineLanes' memo survives the whole gesture; the manifest is written
// once on pointerup.
//
// The "0.0" marker is locked (SPEC §6.6: every animated part starts at
// "0.0"): selectable and editable, but not draggable.
function TimelineMarker({
  part,
  attr,
  label,
  timeKey,
  t,
  duration,
  ease,
  prevT,
  nextT,
  selected,
  disabled,
  onSelectKey,
  onMoveKey,
  onScrub,
}: MarkerProps) {
  const locked = timeKey === ZERO_KEY;
  const [dragT, setDragT] = useState<number | null>(null);

  // Gesture refs — no re-render on arm/slop bookkeeping.
  const armedRef = useRef(false); // pointer down on a draggable marker
  const draggingRef = useRef(false); // passed the slop threshold
  // Mirror of dragT for the commit path: pointermove is a continuous-priority
  // event, so its setDragT may not have re-rendered before pointerup fires —
  // reading the state in handlePointerUp could see a stale (even null) value
  // on a fast flick and silently drop the move. The ref is always current.
  const dragTRef = useRef<number | null>(null);
  const laneRectRef = useRef<DOMRect | null>(null);
  const startXRef = useRef(0);
  const elRef = useRef<HTMLButtonElement | null>(null);
  const pointerIdRef = useRef(0);

  const abortDrag = (): void => {
    if (draggingRef.current) onScrub(Math.min(t, duration));
    armedRef.current = false;
    draggingRef.current = false;
    dragTRef.current = null;
    setDragT(null);
    const el = elRef.current;
    if (el !== null && el.hasPointerCapture(pointerIdRef.current)) {
      el.releasePointerCapture(pointerIdRef.current);
    }
  };

  // Escape aborts an in-flight drag. The dep is the boolean "is dragging",
  // so the listener installs once per gesture, not once per pointermove.
  const dragging = dragT !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') abortDrag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  // clientX → clamped grid time. Snap FIRST (coarse SNAP_STEP, or the fine
  // 1e-3 grid when Alt bypasses), then clamp to the grid-aligned duration and
  // same-attr neighbor bounds (snapping after clamping could round back onto a
  // neighbor).
  const dragTimeFromClientX = (clientX: number, altKey: boolean): number => {
    const rect = laneRectRef.current;
    if (rect === null || duration <= 0) return t;
    const raw = clamp01((clientX - rect.left) / rect.width) * duration;
    const snapped = altKey ? snap(raw) : snap(snapTo(raw, SNAP_STEP));
    const durGrid = Math.floor(duration * 1000) / 1000;
    // A grid step of clearance from each same-attr neighbor (no merge, no
    // crossing). No prev neighbor → 0 is allowed: landing on a "0.0" entry
    // that does not carry this attribute is a legitimate cross-attr merge.
    const min = prevT !== null ? snap(prevT + GRID) : 0;
    const max = Math.min(nextT !== null ? snap(nextT - GRID) : durGrid, durGrid);
    if (min > max) return t; // degenerate gap — pin to the original time
    return Math.min(Math.max(snapped, min), max);
  };

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>): void => {
    // Select immediately (pauses playback, snaps the playhead — WYSIWYG).
    onSelectKey({ part, attr, timeKey });
    if (locked || disabled) return; // selection only, no drag arming
    elRef.current = e.currentTarget;
    pointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    // The marker's offsetParent is .timeline-lane (position: relative); only
    // horizontal geometry matters and it cannot change mid-drag.
    laneRectRef.current =
      e.currentTarget.parentElement?.getBoundingClientRect() ?? null;
    startXRef.current = e.clientX;
    armedRef.current = true;
    draggingRef.current = false;
  };

  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>): void => {
    if (!armedRef.current) return;
    if (
      !draggingRef.current &&
      Math.abs(e.clientX - startXRef.current) <= DRAG_SLOP_PX
    ) {
      return;
    }
    draggingRef.current = true;
    const next = dragTimeFromClientX(e.clientX, e.altKey);
    dragTRef.current = next;
    setDragT(next);
    onScrub(next); // playhead (and the 3D pose) follow the ghost
  };

  const handlePointerUp = (): void => {
    const finalT = dragTRef.current;
    if (draggingRef.current && finalT !== null && formatTimeKey(finalT) !== timeKey) {
      onMoveKey(part, attr, timeKey, finalT);
    }
    armedRef.current = false;
    draggingRef.current = false;
    dragTRef.current = null;
    setDragT(null);
  };

  const frac = (x: number): number => (duration > 0 ? clamp01(x / duration) : 0);
  const shown = dragT ?? t;
  const outOfRange = t > duration;
  // Badge only when this attribute's segment actually deviates from the
  // default (an authored "linear" entry behaves like none).
  const eased = ease !== undefined && ease !== 'linear';
  const easeSuffix = eased ? ` · ease ${ease}` : '';

  const className = [
    'timeline-marker',
    selected ? 'selected' : '',
    locked ? 'locked' : '',
    dragT !== null ? 'dragging' : '',
    outOfRange ? 'out-of-range' : '',
    eased ? 'eased' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {dragT !== null && (
        <div
          className="timeline-marker-ghost"
          style={{ left: `${frac(t) * 100}%` }}
        />
      )}
      <button
        type="button"
        className={className}
        style={{ left: `${frac(shown) * 100}%` }}
        title={
          (locked
            ? `${label} @ ${timeKey}s — start key (locked, SPEC §6.6)`
            : outOfRange
              ? `${label} @ ${timeKey}s — beyond duration`
              : `${label} @ ${dragT !== null ? formatTimeKey(dragT) : timeKey}s`) +
          easeSuffix
        }
        aria-label={`${part} ${label} key at ${timeKey}s`}
        disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={abortDrag}
        onClick={() => onSelectKey({ part, attr, timeKey })}
      />
    </>
  );
}
