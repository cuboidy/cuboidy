import { type ChangeEvent } from 'react';
import { Plus, X } from 'lucide-react';
import {
  isIdentifier,
  type Cvox,
  type Manifest,
  type ManifestPart,
  type Part,
} from '@cuboidy/core';
import { findManifestPart } from '../lib/part-tree.js';
import { NumberInput } from './NumberInput.js';
import { TextInput } from './TextInput.js';

type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];

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
  // cvox (geometry) edits — pivot / sockets — re-serialize the part's
  // defining file, so they're blocked while any cvox source is mid-edit
  // unparseable (same reason as moveDisabled).
  cvoxEditsDisabled: boolean;
  onChangeParent: (partName: string, parent: string | null) => void;
  onChangePosition: (partName: string, axis: 0 | 1 | 2, value: number) => void;
  onRenamePart: (oldName: string, newName: string) => void;
  onDeletePart: (name: string) => void;
  onCreateManifest: () => void;
  onMovePart: (name: string, targetFile: string) => void;
  // Immutably rewrite the selected part's cvox geometry. `build` runs
  // against the part in whatever file defines it; `tag` coalesces a burst
  // of live number-input commits into one undo entry.
  onEditPart: (
    partName: string,
    build: (part: Part) => Part,
    tag?: string,
  ) => void;
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
  cvoxEditsDisabled,
  onChangeParent,
  onChangePosition,
  onRenamePart,
  onDeletePart,
  onCreateManifest,
  onMovePart,
  onEditPart,
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

      <div className="property-section">
        <div className="property-section-title">Geometry</div>
        <GeometryFields
          part={cvoxPart}
          disabled={cvoxEditsDisabled}
          onEditPart={onEditPart}
        />
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

interface GeometryFieldsProps {
  part: Part;
  disabled: boolean;
  onEditPart: (
    partName: string,
    build: (part: Part) => Part,
    tag?: string,
  ) => void;
}

// Set one axis of a Vec3 without disturbing the others (returns a fresh Vec3).
function withAxis(v: { x: number; y: number; z: number }, axis: Axis, value: number) {
  return { ...v, [axis]: value };
}

// cvox-side per-part geometry: pivot (position + optional rotation) and
// sockets. Size stays read-only (shown in the header) — resizing rewrites the
// voxel grid and is deferred to its own step. clone/mirror parts derive their
// geometry from the referent, so there's nothing to edit here.
function GeometryFields({ part, disabled, onEditPart }: GeometryFieldsProps) {
  if (part.from !== undefined) {
    const verb = part.from.mirror !== undefined ? 'mirrors' : 'clones';
    return (
      <p className="property-group-empty">
        Geometry is derived — this part {verb} “{part.from.part}”.
      </p>
    );
  }

  const rot = part.pivot.rot;

  const toggleRot = (on: boolean) => {
    onEditPart(part.name, (p) => {
      if (on) {
        return {
          ...p,
          pivot: { ...p.pivot, rot: p.pivot.rot ?? { x: 0, y: 0, z: 0 } },
        };
      }
      const { rot: _drop, ...rest } = p.pivot;
      return { ...p, pivot: rest };
    });
  };

  const addSocket = () => {
    onEditPart(part.name, (p) => {
      const names = new Set(p.sockets.map((s) => s.name));
      let n = 1;
      while (names.has(`socket${n}`)) n += 1;
      return {
        ...p,
        sockets: [...p.sockets, { name: `socket${n}`, pos: { x: 0, y: 0, z: 0 } }],
      };
    });
  };

  const toggleSocketRot = (i: number, on: boolean) => {
    onEditPart(part.name, (p) => ({
      ...p,
      sockets: p.sockets.map((s, j) => {
        if (j !== i) return s;
        if (on) return { ...s, rot: s.rot ?? { x: 0, y: 0, z: 0 } };
        const { rot: _drop, ...rest } = s;
        return rest;
      }),
    }));
  };

  return (
    <div className={`property-group${disabled ? ' disabled' : ''}`}>
      <label className="property-field">
        <span className="property-field-label">pivot</span>
        <div className="property-position">
          {AXES.map((axis) => (
            <NumberInput
              key={axis}
              label={axis}
              value={part.pivot.pos[axis]}
              disabled={disabled}
              onChange={(v) =>
                onEditPart(
                  part.name,
                  (p) => ({
                    ...p,
                    pivot: { ...p.pivot, pos: withAxis(p.pivot.pos, axis, v) },
                  }),
                  `pivot:pos:${part.name}:${axis}`,
                )
              }
            />
          ))}
        </div>
      </label>

      <label className="property-check">
        <input
          type="checkbox"
          checked={rot !== undefined}
          disabled={disabled}
          onChange={(e) => toggleRot(e.target.checked)}
        />
        <span>pivot rotation</span>
      </label>
      {rot !== undefined && (
        <div className="property-position property-position-indent">
          {AXES.map((axis) => (
            <NumberInput
              key={axis}
              label={axis}
              value={rot[axis]}
              disabled={disabled}
              onChange={(v) =>
                onEditPart(
                  part.name,
                  (p) => ({
                    ...p,
                    pivot: {
                      ...p.pivot,
                      rot: withAxis(p.pivot.rot ?? { x: 0, y: 0, z: 0 }, axis, v),
                    },
                  }),
                  `pivot:rot:${part.name}:${axis}`,
                )
              }
            />
          ))}
        </div>
      )}

      <div className="property-field-label socket-list-label">sockets</div>
      {part.sockets.length === 0 && (
        <p className="socket-empty">No sockets.</p>
      )}
      {part.sockets.map((socket, i) => (
        <div className="socket-row" key={i}>
          <div className="socket-row-head">
            <TextInput
              value={socket.name}
              disabled={disabled}
              ariaLabel="Socket name"
              validate={(name) =>
                isIdentifier(name) &&
                !part.sockets.some((s, j) => j !== i && s.name === name)
              }
              onCommit={(name) =>
                onEditPart(part.name, (p) => ({
                  ...p,
                  sockets: p.sockets.map((s, j) =>
                    j === i ? { ...s, name } : s,
                  ),
                }))
              }
            />
            <button
              type="button"
              className="btn btn-icon btn-sm socket-remove"
              disabled={disabled}
              title="Remove socket"
              aria-label="Remove socket"
              onClick={() =>
                onEditPart(part.name, (p) => ({
                  ...p,
                  sockets: p.sockets.filter((_, j) => j !== i),
                }))
              }
            >
              <X size={13} />
            </button>
          </div>
          <div className="property-position">
            {AXES.map((axis) => (
              <NumberInput
                key={axis}
                label={axis}
                value={socket.pos[axis]}
                disabled={disabled}
                onChange={(v) =>
                  onEditPart(
                    part.name,
                    (p) => ({
                      ...p,
                      sockets: p.sockets.map((s, j) =>
                        j === i ? { ...s, pos: withAxis(s.pos, axis, v) } : s,
                      ),
                    }),
                    `socket:pos:${part.name}:${i}:${axis}`,
                  )
                }
              />
            ))}
          </div>
          <label className="property-check">
            <input
              type="checkbox"
              checked={socket.rot !== undefined}
              disabled={disabled}
              onChange={(e) => toggleSocketRot(i, e.target.checked)}
            />
            <span>rotation</span>
          </label>
          {socket.rot !== undefined && (
            <div className="property-position property-position-indent">
              {AXES.map((axis) => (
                <NumberInput
                  key={axis}
                  label={axis}
                  value={socket.rot![axis]}
                  disabled={disabled}
                  onChange={(v) =>
                    onEditPart(
                      part.name,
                      (p) => ({
                        ...p,
                        sockets: p.sockets.map((s, j) =>
                          j === i
                            ? {
                                ...s,
                                rot: withAxis(
                                  s.rot ?? { x: 0, y: 0, z: 0 },
                                  axis,
                                  v,
                                ),
                              }
                            : s,
                        ),
                      }),
                      `socket:rot:${part.name}:${i}:${axis}`,
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        className="btn btn-create btn-sm socket-add"
        disabled={disabled}
        onClick={addSocket}
      >
        <Plus size={13} />
        socket
      </button>
    </div>
  );
}

