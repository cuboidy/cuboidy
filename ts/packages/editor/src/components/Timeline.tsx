import { memo, useMemo, useRef, type PointerEvent } from 'react';
import type { AnimationTrack, InlineAnimation, KeyAttr } from '@cuboidy/core';
import type { SelectedKey } from '../lib/types.js';

// Width (px) of the left label gutter. Single-sourced here and fed to both
// the gutter elements and the playhead's horizontal offset so the playhead
// lines up with the lanes without measuring the DOM.
const LABEL_W = 96;

const ATTRS: ReadonlyArray<{ key: KeyAttr; label: string }> = [
  { key: 'rot', label: 'rot' },
  { key: 'pos', label: 'pos' },
  { key: 'scale', label: 'scale' },
  { key: 'visible', label: 'vis' },
];

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// Time-keys (sorted) whose keyframe carries `attr` — the per-attribute lane's
// markers, derived from the sparse Keyframe map.
function markerTimes(
  track: AnimationTrack | undefined,
  attr: KeyAttr,
): { t: number; timeKey: string }[] {
  if (track === undefined) return [];
  return Object.keys(track)
    .filter((k) => attr in track[k]!)
    .map((k) => ({ t: Number(k), timeKey: k }))
    .filter((m) => Number.isFinite(m.t))
    .sort((a, b) => a.t - b.t);
}

interface Props {
  partNames: readonly string[];
  inline: InlineAnimation;
  time: number;
  selectedKey: SelectedKey | null;
  disabled: boolean;
  onScrub: (t: number) => void;
  onSelectKey: (k: SelectedKey) => void;
  onAddKey: (part: string, attr: KeyAttr) => void;
}

// Premiere/AE-style timeline: one row per model part, each expanded into
// rot/pos/scale/visible lanes. The playhead overlay is the only thing that
// depends on `time`, so the marker grid (TimelineLanes) is memoized and
// skips re-render during playback.
export function Timeline({
  partNames,
  inline,
  time,
  selectedKey,
  disabled,
  onScrub,
  onSelectKey,
  onAddKey,
}: Props) {
  const duration = inline.duration;
  const rulerRef = useRef<HTMLDivElement>(null);

  const scrubTo = (clientX: number): void => {
    const el = rulerRef.current;
    if (el === null || duration <= 0) return;
    const r = el.getBoundingClientRect();
    onScrub(clamp01((clientX - r.left) / r.width) * duration);
  };
  const handleRulerDown = (e: PointerEvent<HTMLDivElement>): void => {
    scrubTo(e.clientX);
  };

  const headFrac = duration > 0 ? clamp01(time / duration) : 0;

  return (
    <div className="timeline">
      <div className="timeline-ruler-row">
        <div className="timeline-gutter" style={{ width: LABEL_W }} />
        <div
          className="timeline-ruler"
          ref={rulerRef}
          onPointerDown={handleRulerDown}
        />
      </div>
      <div className="timeline-scroll">
        <TimelineLanes
          partNames={partNames}
          inline={inline}
          selectedKey={selectedKey}
          disabled={disabled}
          onSelectKey={onSelectKey}
          onAddKey={onAddKey}
        />
      </div>
      {/* Playhead spans the whole timeline; offset LABEL_W + a fraction of the
          remaining (lane) width so it lines up with the markers. */}
      <div
        className="timeline-playhead"
        style={{ left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${headFrac})` }}
      />
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
}

const TimelineLanes = memo(function TimelineLanes({
  partNames,
  inline,
  selectedKey,
  disabled,
  onSelectKey,
  onAddKey,
}: LanesProps) {
  const duration = inline.duration;

  // Markers depend only on the animation data, not on `time`. Recomputed
  // when a key is added/edited/deleted (inline changes), never on playback.
  const markers = useMemo(() => {
    const m = new Map<string, Record<KeyAttr, { t: number; timeKey: string }[]>>();
    for (const part of partNames) {
      const track = inline.parts[part];
      m.set(part, {
        rot: markerTimes(track, 'rot'),
        pos: markerTimes(track, 'pos'),
        scale: markerTimes(track, 'scale'),
        visible: markerTimes(track, 'visible'),
      });
    }
    return m;
  }, [partNames, inline]);

  const frac = (t: number): number => (duration > 0 ? clamp01(t / duration) : 0);

  return (
    <div className="timeline-body">
      {partNames.map((part) => {
        const rec = markers.get(part);
        return (
          <div className="timeline-part" key={part}>
            <div className="timeline-part-label" title={part}>
              {part}
            </div>
            {ATTRS.map(({ key, label }) => (
              <div className="timeline-attr-row" key={key}>
                <div className="timeline-attr-head" style={{ width: LABEL_W }}>
                  <span className="timeline-attr-label">{label}</span>
                  <button
                    type="button"
                    className="timeline-add"
                    title={`Add ${label} key at playhead`}
                    disabled={disabled}
                    onClick={() => onAddKey(part, key)}
                  >
                    +
                  </button>
                </div>
                <div className="timeline-lane">
                  {(rec?.[key] ?? []).map(({ t, timeKey }) => {
                    const sel =
                      selectedKey !== null &&
                      selectedKey.part === part &&
                      selectedKey.attr === key &&
                      selectedKey.timeKey === timeKey;
                    return (
                      <button
                        key={timeKey}
                        type="button"
                        className={`timeline-marker${sel ? ' selected' : ''}`}
                        style={{ left: `${frac(t) * 100}%` }}
                        title={`${label} @ ${timeKey}s`}
                        aria-label={`${part} ${label} key at ${timeKey}s`}
                        disabled={disabled}
                        onClick={() => onSelectKey({ part, attr: key, timeKey })}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
});
