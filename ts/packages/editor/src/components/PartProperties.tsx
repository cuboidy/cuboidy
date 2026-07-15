import { type ChangeEvent } from 'react';
import { Plus } from 'lucide-react';
import { isIdentifier, type Cvox, type Manifest, type ManifestPart } from '@cuboidy/core';
import { findManifestPart } from '../lib/part-tree.js';
import { NumberInput } from './NumberInput.js';
import { TextInput } from './TextInput.js';

interface Props {
  selectedPart: string;
  cvox: Cvox;
  manifest: Manifest | undefined;
  // Disabled while the manifest source has parse errors — a
  // structural edit here would re-serialize from a stale AST and
  // clobber the user's in-progress source-tab text.
  manifestEditsDisabled: boolean;
  // Renaming rewrites cvox (always) and the manifest (if present), so it's
  // blocked while either source has syntax errors.
  renameDisabled: boolean;
  // Defining-file field (v0.7 multi-cvox): all geometry files in
  // geometry-list order, and the selected part's current file. Both
  // present only when the model spans more than one file — changing the
  // select moves the part's declaration.
  geometryFiles?: readonly string[] | undefined;
  partFile?: string | undefined;
  // A move re-serializes two cvox files, so it's blocked while any has
  // syntax errors (a rewrite would clobber the in-progress text).
  moveDisabled: boolean;
  onChangeParent: (partName: string, parent: string | null) => void;
  onChangePosition: (partName: string, axis: 0 | 1 | 2, value: number) => void;
  onRenamePart: (oldName: string, newName: string) => void;
  onDeletePart: (name: string) => void;
  onCreateManifest: () => void;
  onMovePart: (name: string, targetFile: string) => void;
}

const NONE_VALUE = '__none__';

// Right-panel inspector for a single selected part. Phase 1 surfaces
// the rig fields (parent + position) only; cvox-side fields (size /
// pivot / sockets) get their own section in a follow-up stage.

export function PartProperties({
  selectedPart,
  cvox,
  manifest,
  manifestEditsDisabled,
  renameDisabled,
  geometryFiles,
  partFile,
  moveDisabled,
  onChangeParent,
  onChangePosition,
  onRenamePart,
  onDeletePart,
  onCreateManifest,
  onMovePart,
}: Props) {
  const cvoxPart = cvox.parts.find((p) => p.name === selectedPart);
  if (cvoxPart === undefined) {
    // Selection points at a part that no longer exists in cvox (e.g.,
    // the user just edited the source view to remove it). Render
    // nothing — the App will clear selection on the next render via
    // the same effect that prunes stale state elsewhere.
    return null;
  }

  const manifestPart =
    manifest !== undefined ? findManifestPart(manifest, selectedPart) : undefined;
  const hasManifest = manifest !== undefined;
  const rigDisabled = !hasManifest || manifestEditsDisabled;

  // Parts that clone/mirror this one would dangle if it were deleted, so delete
  // is blocked while any exist (the user repoints/renames them first).
  const clonedBy = cvox.parts
    .filter((p) => p.name !== selectedPart && p.from?.part === selectedPart)
    .map((p) => p.name);
  // A model needs at least one part; the last one can't be deleted.
  const isOnlyPart = cvox.parts.length <= 1;
  const deleteDisabled = renameDisabled || clonedBy.length > 0 || isOnlyPart;
  const deleteTitle =
    clonedBy.length > 0
      ? `Can't delete — cloned/mirrored by: ${clonedBy.join(', ')}`
      : isOnlyPart
        ? "Can't delete the only part"
        : renameDisabled
          ? 'Fix source syntax errors to delete'
          : 'Delete this part (undo restores it)';

  return (
    <section className="part-properties">
      <div className="part-properties-header">
        <div className="part-properties-name-edit">
          <TextInput
            value={selectedPart}
            disabled={renameDisabled}
            ariaLabel="Part name"
            validate={(name) =>
              isIdentifier(name) &&
              (name === selectedPart ||
                !cvox.parts.some((p) => p.name === name))
            }
            onCommit={(name) => onRenamePart(selectedPart, name)}
          />
        </div>
        <span className="part-properties-meta">
          {cvoxPart.size.w}×{cvoxPart.size.h}×{cvoxPart.size.d}
        </span>
      </div>

      {geometryFiles !== undefined && partFile !== undefined && (
        <label className="property-field">
          <span className="property-field-label">file</span>
          <select
            value={partFile}
            disabled={moveDisabled}
            title={
              moveDisabled
                ? 'Fix cvox syntax errors to move parts between files'
                : 'Geometry file this part is declared in — change to move it'
            }
            onChange={(e) => {
              if (e.target.value !== partFile) {
                onMovePart(selectedPart, e.target.value);
              }
            }}
          >
            {geometryFiles.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className={`property-group${rigDisabled ? ' disabled' : ''}`}>
        {!hasManifest && (
          <div className="property-group-empty">
            <p>No manifest — parent and position can't be set yet.</p>
            <button
              type="button"
              className="btn btn-create btn-sm create-manifest-inline"
              onClick={onCreateManifest}
            >
              <Plus size={13} />
              Create manifest
            </button>
          </div>
        )}
        {hasManifest && manifestEditsDisabled && (
          <p className="property-group-note">
            Manifest source has syntax errors — fix to enable rig editing.
          </p>
        )}
        {hasManifest && (
          <RigFields
            selectedPart={selectedPart}
            cvox={cvox}
            manifestPart={manifestPart}
            disabled={manifestEditsDisabled}
            onChangeParent={onChangeParent}
            onChangePosition={onChangePosition}
          />
        )}
      </div>

      <div className="part-properties-footer">
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={deleteDisabled}
          title={deleteTitle}
          onClick={() => onDeletePart(selectedPart)}
        >
          Delete part
        </button>
      </div>
    </section>
  );
}

interface RigFieldsProps {
  selectedPart: string;
  cvox: Cvox;
  manifestPart: ManifestPart | undefined;
  disabled: boolean;
  onChangeParent: (partName: string, parent: string | null) => void;
  onChangePosition: (partName: string, axis: 0 | 1 | 2, value: number) => void;
}

function RigFields({
  selectedPart,
  cvox,
  manifestPart,
  disabled,
  onChangeParent,
  onChangePosition,
}: RigFieldsProps) {
  const position = manifestPart?.position ?? [0, 0, 0];
  const parent = manifestPart?.parent ?? null;

  const handleParent = (e: ChangeEvent<HTMLSelectElement>) => {
    onChangeParent(
      selectedPart,
      e.target.value === NONE_VALUE ? null : e.target.value,
    );
  };

  return (
    <>
      <label className="property-field">
        <span className="property-field-label">parent</span>
        <select
          value={parent ?? NONE_VALUE}
          disabled={disabled}
          onChange={handleParent}
        >
          <option value={NONE_VALUE}>(none)</option>
          {cvox.parts
            .filter((p) => p.name !== selectedPart)
            .map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <div className="property-position">
        <NumberInput
          label="x"
          value={position[0]}
          disabled={disabled}
          onChange={(v) => onChangePosition(selectedPart, 0, v)}
        />
        <NumberInput
          label="y"
          value={position[1]}
          disabled={disabled}
          onChange={(v) => onChangePosition(selectedPart, 1, v)}
        />
        <NumberInput
          label="z"
          value={position[2]}
          disabled={disabled}
          onChange={(v) => onChangePosition(selectedPart, 2, v)}
        />
      </div>
    </>
  );
}

