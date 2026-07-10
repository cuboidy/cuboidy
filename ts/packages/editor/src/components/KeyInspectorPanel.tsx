import {
  DEFAULT_EASING,
  resolveTrackEase,
  type AnimationTrack,
  type AttrValue,
  type EasingName,
  type KeyAttr,
} from '@cuboidy/core';
import type { AnimationSession } from '../lib/useAnimationSession.js';
import { KeyInspector } from './KeyInspector.js';

interface Props {
  session: AnimationSession;
  manifestEditsDisabled: boolean;
  onSetAnimField: (
    animName: string,
    part: string,
    timeKey: string,
    attr: KeyAttr,
    value: AttrValue,
  ) => void;
  onSetAnimEase: (
    animName: string,
    part: string,
    timeKey: string,
    ease: EasingName | undefined,
  ) => void;
  onDeleteAnimKey: (
    animName: string,
    part: string,
    timeKey: string,
    attr: KeyAttr,
  ) => void;
}

// What §6.5 carryover would give `timeKey` if it carried no explicit ease:
// the resolved ease of the nearest earlier key, linear before the first.
function inheritedEaseAt(track: AnimationTrack, timeKey: string): EasingName {
  const resolved = resolveTrackEase(track);
  const t = Number(timeKey);
  let best: EasingName = DEFAULT_EASING;
  let bestT = -Infinity;
  for (const [k, ease] of Object.entries(resolved)) {
    const kt = Number(k);
    if (kt < t && kt > bestT) {
      bestT = kt;
      best = ease;
    }
  }
  return best;
}

// The Key Inspector as its own dock panel (M4): the selection detail of the
// keyframe editor, reading the shared animation session. Shows an empty
// state until a timeline marker is selected; the KeyInspector inside is the
// same component that used to sit as a fixed sidebar in the Timeline panel.
export function KeyInspectorPanel({
  session,
  manifestEditsDisabled,
  onSetAnimField,
  onSetAnimEase,
  onDeleteAnimKey,
}: Props) {
  const {
    activeName,
    inline,
    effectiveSelectedKey,
    keyClipboard,
    setSelectedKey,
    retimeKey,
    copySelectedKey,
    pasteAtPlayhead,
  } = session;

  const selectedKeyframe =
    effectiveSelectedKey !== null
      ? inline?.parts[effectiveSelectedKey.part]?.[effectiveSelectedKey.timeKey]
      : undefined;

  if (
    inline === undefined ||
    effectiveSelectedKey === null ||
    selectedKeyframe === undefined
  ) {
    return (
      <p className="panel-empty">
        {inline === undefined
          ? 'No animation clip to inspect.'
          : 'Select a keyframe in the Timeline to edit it.'}
      </p>
    );
  }

  const selectedTrack = inline.parts[effectiveSelectedKey.part];
  const inheritedEase =
    selectedTrack !== undefined
      ? inheritedEaseAt(selectedTrack, effectiveSelectedKey.timeKey)
      : DEFAULT_EASING;

  // Human summary of the copied keyframe for the Paste button's tooltip,
  // e.g. "tail @ 0.5s (rot, pos, ease)".
  const clipboardSummary =
    keyClipboard !== null
      ? `${keyClipboard.part} @ ${keyClipboard.timeKey}s (${Object.keys(
          keyClipboard.kf,
        ).join(', ')})`
      : null;

  return (
    <KeyInspector
      selectedKey={effectiveSelectedKey}
      keyframe={selectedKeyframe}
      inheritedEase={inheritedEase}
      disabled={manifestEditsDisabled}
      onSetTime={(t) =>
        retimeKey(
          effectiveSelectedKey.part,
          effectiveSelectedKey.attr,
          effectiveSelectedKey.timeKey,
          t,
        )
      }
      onSetField={(value) =>
        onSetAnimField(
          activeName,
          effectiveSelectedKey.part,
          effectiveSelectedKey.timeKey,
          effectiveSelectedKey.attr,
          value,
        )
      }
      onSetEase={(ease) =>
        onSetAnimEase(
          activeName,
          effectiveSelectedKey.part,
          effectiveSelectedKey.timeKey,
          ease,
        )
      }
      clipboardSummary={clipboardSummary}
      onCopy={copySelectedKey}
      onPaste={pasteAtPlayhead}
      onDelete={() => {
        onDeleteAnimKey(
          activeName,
          effectiveSelectedKey.part,
          effectiveSelectedKey.timeKey,
          effectiveSelectedKey.attr,
        );
        setSelectedKey(null);
      }}
    />
  );
}
