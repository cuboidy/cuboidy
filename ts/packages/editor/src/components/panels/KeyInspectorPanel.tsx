import type {
  AttrValue,
  EaseAttr,
  EasingName,
  KeyAttr,
} from '@cuboidy/core';
import type { AnimationSession } from '../../lib/useAnimationSession.js';
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
    attr: EaseAttr,
    ease: EasingName | undefined,
  ) => void;
  onDeleteAnimKey: (
    animName: string,
    part: string,
    timeKey: string,
    attr: KeyAttr,
  ) => void;
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
      onSetEase={(ease) => {
        // KeyInspector only surfaces the ease editor for interpolating
        // attributes, so the narrowing guard here never actually skips.
        const { attr } = effectiveSelectedKey;
        if (attr !== 'visible') {
          onSetAnimEase(
            activeName,
            effectiveSelectedKey.part,
            effectiveSelectedKey.timeKey,
            attr,
            ease,
          );
        }
      }}
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
