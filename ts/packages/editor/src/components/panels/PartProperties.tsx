import { useState, type ChangeEvent } from 'react';
import { Copy, FlipHorizontal2, Plus, X } from 'lucide-react';
import { AIR, isIdentifier, type Geometry, type Manifest, type ManifestPart, type Part, type Size } from '@cuboidy/core';
import { findManifestPart } from '../../lib/part-tree.js';
import { NumberInput } from '@cuboidy/ui';
import { TextInput } from '@cuboidy/ui';

type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];

interface Props {
  selectedPart: string;
  geometry: Geometry;
  manifest: Manifest | undefined;
  // Disabled while the manifest source has parse errors — a
  // structural edit here would re-serialize from a stale AST and
  // clobber the user's in-progress source-tab text.
  manifestEditsDisabled: boolean;
  // Renaming rewrites geometry (always) and the manifest (if present), so it's
  // blocked while either source has syntax errors.
  renameDisabled: boolean;
  // Defining-file field (v0.7 multi-geometry): all geometry files in
  // geometry-list order, and the selected part's current file. Both
  // present only when the model spans more than one file — changing the
  // select moves the part's declaration.
  geometryFiles?: readonly string[] | undefined;
  partFile?: string | undefined;
  // A move re-serializes two geometry files, so it's blocked while any has
  // syntax errors (a rewrite would clobber the in-progress text).
  moveDisabled: boolean;
  // Geometry edits — pivot / sockets — re-serialize the part's
  // defining file, so they're blocked while any geometry source is mid-edit
  // unparseable (same reason as moveDisabled).
  geometryEditsDisabled: boolean;
  onChangeParent: (partName: string, parent: string | null) => void;
  onChangePosition: (partName: string, axis: 0 | 1 | 2, value: number) => void;
  // Rest rotation (SPEC §6.2): Euler degrees around the part's pivot.
  // Toggle off = drop the field (identity), matching pivot rotation.
  onChangeRotation: (partName: string, axis: 0 | 1 | 2, value: number) => void;
  onToggleRotation: (partName: string, on: boolean) => void;
  onRenamePart: (oldName: string, newName: string) => void;
  onDeletePart: (name: string) => void;
  onMovePart: (name: string, targetFile: string) => void;
  // Immutably rewrite the selected part's geometry. `build` runs
  // against the part in whatever file defines it; `tag` coalesces a burst
  // of live number-input commits into one undo entry.
  onEditPart: (
    partName: string,
    build: (part: Part) => Part,
    tag?: string,
  ) => void;
  // Socket name / lifetime / publication (SPEC §6.12). Separate from
  // onEditPart because each may have to rewrite the manifest as well as
  // the geometry file, in one undo step.
  onRenameSocket: (partName: string, index: number, name: string) => void;
  onDeleteSocket: (partName: string, index: number) => void;
  onPublishSocket: (
    partName: string,
    socketName: string,
    publicName: string | null,
  ) => void;
  // Duplicate: append a concrete copy of this part to its file (geometry
  // only, no manifest rig). Mirror: reflect this part in place across the
  // axis. Both match the cuboidy-part CLI.
  onDuplicatePart: (name: string) => void;
  onMirrorPart: (name: string, axis: Axis) => void;
}

const NONE_VALUE = '__none__';

// Right-panel inspector for a single selected part: the manifest's rig
// fields (parent / position / rotation) plus the geometry-side section
// (size / pivot / sockets — GeometryFields below).

export function PartProperties({
  selectedPart,
  geometry,
  manifest,
  manifestEditsDisabled,
  renameDisabled,
  geometryFiles,
  partFile,
  moveDisabled,
  geometryEditsDisabled,
  onChangeParent,
  onChangePosition,
  onChangeRotation,
  onToggleRotation,
  onRenamePart,
  onDeletePart,
  onMovePart,
  onEditPart,
  onRenameSocket,
  onDeleteSocket,
  onPublishSocket,
  onDuplicatePart,
  onMirrorPart,
}: Props) {
  const [mirrorAxis, setMirrorAxis] = useState<Axis>('x');
  const geometryPart = geometry.parts.find((p) => p.name === selectedPart);
  if (geometryPart === undefined) {
    // Selection points at a part that no longer exists in geometry (e.g.,
    // the user just edited the source view to remove it). Render
    // nothing — the App will clear selection on the next render via
    // the same effect that prunes stale state elsewhere.
    return null;
  }

  const manifestPart =
    manifest !== undefined ? findManifestPart(manifest, selectedPart) : undefined;
  const hasManifest = manifest !== undefined;
  const rigDisabled = !hasManifest || manifestEditsDisabled;

  // SPEC §6.12 publications, split into what the socket rows need: this
  // part's socket → published name, and every published name in the model
  // (uniqueness is model-wide, so a row must know about the others).
  const publishedNames = new Set(Object.keys(manifest?.sockets ?? {}));
  const publications = new Map<string, string>();
  for (const [pub, target] of Object.entries(manifest?.sockets ?? {})) {
    // First wins: a socket may be published twice, and the row edits the
    // first — same rule the publish handler applies.
    if (target.part === selectedPart && !publications.has(target.socket)) {
      publications.set(target.socket, pub);
    }
  }

  // A model needs at least one part; the last one can't be deleted.
  const isOnlyPart = geometry.parts.length <= 1;
  const deleteDisabled = renameDisabled || isOnlyPart;
  const deleteTitle = isOnlyPart
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
                !geometry.parts.some((p) => p.name === name))
            }
            onCommit={(name) => onRenamePart(selectedPart, name)}
          />
        </div>
        <span className="part-properties-meta">
          {geometryPart.size.w}×{geometryPart.size.h}×{geometryPart.size.d}
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
                ? 'Fix the geometry file errors to move parts between files'
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
            <p>
              cuboidy.json doesn&apos;t parse — fix it to edit this part&apos;s
              rig.
            </p>
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
            geometry={geometry}
            manifestPart={manifestPart}
            disabled={manifestEditsDisabled}
            onChangeParent={onChangeParent}
            onChangePosition={onChangePosition}
            onChangeRotation={onChangeRotation}
            onToggleRotation={onToggleRotation}
          />
        )}
      </div>

      <div className="property-section">
        <div className="property-section-title">Geometry</div>
        <GeometryFields
          part={geometryPart}
          disabled={geometryEditsDisabled}
          publications={publications}
          takenNames={publishedNames}
          publishDisabled={rigDisabled}
          onEditPart={onEditPart}
          onRenameSocket={onRenameSocket}
          onDeleteSocket={onDeleteSocket}
          onPublishSocket={onPublishSocket}
        />
      </div>

      <div className="part-properties-footer">
        <div className="part-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={geometryEditsDisabled}
            title={
              geometryEditsDisabled
                ? 'Fix the geometry file errors to duplicate'
                : 'Add a concrete copy of this part to its file'
            }
            onClick={() => onDuplicatePart(selectedPart)}
          >
            <Copy size={13} />
            Duplicate
          </button>
          <div className="mirror-action">
            <button
              type="button"
              className="btn btn-sm"
              disabled={geometryEditsDisabled}
              title={
                geometryEditsDisabled
                  ? 'Fix the geometry file errors to mirror'
                  : `Flip this part across ${mirrorAxis} (in place)`
              }
              onClick={() => onMirrorPart(selectedPart, mirrorAxis)}
            >
              <FlipHorizontal2 size={13} />
              Mirror
            </button>
            <select
              value={mirrorAxis}
              disabled={geometryEditsDisabled}
              aria-label="Mirror axis"
              onChange={(e) => setMirrorAxis(e.target.value as Axis)}
            >
              <option value="x">x</option>
              <option value="y">y</option>
              <option value="z">z</option>
            </select>
          </div>
        </div>
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
  geometry: Geometry;
  manifestPart: ManifestPart | undefined;
  disabled: boolean;
  onChangeParent: (partName: string, parent: string | null) => void;
  onChangePosition: (partName: string, axis: 0 | 1 | 2, value: number) => void;
  onChangeRotation: (partName: string, axis: 0 | 1 | 2, value: number) => void;
  onToggleRotation: (partName: string, on: boolean) => void;
}

function RigFields({
  selectedPart,
  geometry,
  manifestPart,
  disabled,
  onChangeParent,
  onChangePosition,
  onChangeRotation,
  onToggleRotation,
}: RigFieldsProps) {
  const position = manifestPart?.position ?? [0, 0, 0];
  const rotation = manifestPart?.rotation;
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
          {geometry.parts
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
      <label className="property-check">
        <input
          type="checkbox"
          checked={rotation !== undefined}
          disabled={disabled}
          onChange={(e) => onToggleRotation(selectedPart, e.target.checked)}
        />
        <span>rotation</span>
      </label>
      {rotation !== undefined && (
        <div className="property-position property-position-indent">
          {([0, 1, 2] as const).map((axis) => (
            <NumberInput
              key={axis}
              label={AXES[axis]!}
              value={rotation[axis]}
              disabled={disabled}
              onChange={(v) => onChangeRotation(selectedPart, axis, v)}
            />
          ))}
        </div>
      )}
    </>
  );
}

interface GeometryFieldsProps {
  part: Part;
  disabled: boolean;
  // SPEC §6.12 publication state. `publications` maps THIS part's socket
  // names to the model-level names they're published under (absent = not
  // published); `takenNames` is every published name in the model, for the
  // uniqueness check; `publishDisabled` is the manifest gate — publishing
  // writes cuboidy.json, so it's blocked for the same reasons the rig
  // fields are, independently of `disabled` (which gates geometry).
  publications: ReadonlyMap<string, string>;
  takenNames: ReadonlySet<string>;
  publishDisabled: boolean;
  onEditPart: (
    partName: string,
    build: (part: Part) => Part,
    tag?: string,
  ) => void;
  // Renaming or removing a socket may also rewrite its publication, so
  // these two can't ride the geometry-only onEditPart path.
  onRenameSocket: (partName: string, index: number, name: string) => void;
  onDeleteSocket: (partName: string, index: number) => void;
  onPublishSocket: (
    partName: string,
    socketName: string,
    publicName: string | null,
  ) => void;
}

// Set one axis of a Vec3 without disturbing the others (returns a fresh Vec3).
function withAxis(v: { x: number; y: number; z: number }, axis: Axis, value: number) {
  return { ...v, [axis]: value };
}

// Rebuild the voxel grid for a new size: existing cells (indexed [y][z][x],
// dims [h][d][w]) are kept where they overlap; grown cells fill with AIR;
// shrunk ones are dropped. Shrinking loses data by design (undo restores it) —
// no confirmation prompt.
function resizeVoxels(
  voxels: Part['voxels'],
  size: Size,
): number[][][] {
  const out: number[][][] = [];
  for (let y = 0; y < size.h; y++) {
    const srcLayer = voxels[y];
    const layer: number[][] = [];
    for (let z = 0; z < size.d; z++) {
      const srcRow = srcLayer?.[z];
      const row: number[] = [];
      for (let x = 0; x < size.w; x++) row.push(srcRow?.[x] ?? AIR);
      layer.push(row);
    }
    out.push(layer);
  }
  return out;
}

// geometry-side per-part geometry: size, pivot (position + optional rotation) and
// sockets.
function GeometryFields({
  part,
  disabled,
  publications,
  takenNames,
  publishDisabled,
  onEditPart,
  onRenameSocket,
  onDeleteSocket,
  onPublishSocket,
}: GeometryFieldsProps) {
  const rot = part.pivot.rot;

  // Resize one dimension. Committed on blur (not per keystroke) so typing
  // "12" doesn't first crop to 1 and throw the data away before the 2 lands.
  // Clamped to a whole number ≥ 1; the voxel grid is rebuilt to match.
  const setSizeDim = (dim: keyof Size, value: number) => {
    onEditPart(part.name, (p) => {
      const n = Math.max(1, Math.floor(value));
      if (n === p.size[dim]) return p;
      const size = { ...p.size, [dim]: n };
      return { ...p, size, voxels: resizeVoxels(p.voxels, size) };
    });
  };

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
        <span className="property-field-label">size</span>
        <div className="property-position">
          {(['w', 'h', 'd'] as const).map((dim) => (
            <NumberInput
              key={dim}
              label={dim}
              value={part.size[dim]}
              disabled={disabled}
              step="1"
              // Commit on blur/Enter: a mid-type crop would discard voxels.
              commitOnBlur
              onChange={(v) => setSizeDim(dim, v)}
            />
          ))}
        </div>
      </label>

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
              onCommit={(name) => onRenameSocket(part.name, i, name)}
            />
            <button
              type="button"
              className="btn btn-icon btn-sm socket-remove"
              disabled={disabled}
              title="Remove socket"
              aria-label="Remove socket"
              onClick={() => onDeleteSocket(part.name, i)}
            >
              <X size={13} />
            </button>
          </div>
          <label className="property-field socket-publish">
            <span className="property-field-label">published as</span>
            <TextInput
              value={publications.get(socket.name) ?? ''}
              disabled={publishDisabled}
              placeholder="not published"
              ariaLabel={`Published name for socket ${socket.name}`}
              // Empty unpublishes. Otherwise a §5 identifier that no OTHER
              // publication is already using — published names are manifest
              // object keys, so a collision would drop the other entry.
              validate={(v) =>
                v === '' ||
                (isIdentifier(v) &&
                  (v === publications.get(socket.name) || !takenNames.has(v)))
              }
              onCommit={(v) =>
                onPublishSocket(part.name, socket.name, v === '' ? null : v)
              }
            />
          </label>
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

