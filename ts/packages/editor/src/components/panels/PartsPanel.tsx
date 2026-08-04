import { isIdentifier, type Manifest, type Part } from '@cuboidy/core';
import { Plus } from 'lucide-react';
import { VisibilityButtons } from '@cuboidy/ui';
import { FileRefPicker } from '../ui/FileRefPicker.js';
import { PartTree } from './PartTree.js';

interface Props {
  parts: readonly Part[];
  // Defining file per part name, for the tree's file badges. Undefined for
  // a single-geometry model, where the badge would say nothing.
  partFiles?: ReadonlyMap<string, string> | undefined;
  // Geometry files a new part may be created in — the draft row's picker.
  // Undefined for a single-geometry model, where there is no choice.
  geometryFiles?: readonly string[] | undefined;
  manifest?: Manifest | undefined;
  hiddenParts: ReadonlySet<string>;
  selectedPart: string | null;
  // The in-progress "new part" draft (null = none), owned by App because
  // confirming it is a document edit.
  creating: { parent: string | null } | null;
  // Any file's source text is mid-edit unparseable: creating or renaming a
  // part would re-serialize an AST over it.
  editsBlocked: boolean;
  // Geometry files in the package the model does NOT reference (§6.9).
  // Adopting one brings its parts into the rig — which is why the
  // operation lives here, where parts are, rather than on a file row.
  unreferencedGeometry: readonly string[];
  onAddGeometryFile: (path: string) => void;
  onStartCreate: () => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onToggleVisibility: (name: string) => void;
  onSelectPart: (name: string | null) => void;
  onChangeParent: (name: string, parent: string | null) => void;
  onConfirmCreate: (name: string, file?: string) => void;
  onCancelCreate: () => void;
  onRenamePart: (oldName: string, newName: string) => void;
}

// The Parts panel: a toolbar over the rig tree. The toolbar sits OUTSIDE
// the scroller deliberately — inside it, the drag auto-scroll zone at the
// scroller's top edge hid behind the sticky toolbar, so an upward drag
// only scrolled once the pointer had cleared it.
export function PartsPanel({
  parts,
  partFiles,
  geometryFiles,
  manifest,
  hiddenParts,
  selectedPart,
  creating,
  editsBlocked,
  unreferencedGeometry,
  onAddGeometryFile,
  onStartCreate,
  onShowAll,
  onHideAll,
  onToggleVisibility,
  onSelectPart,
  onChangeParent,
  onConfirmCreate,
  onCancelCreate,
  onRenamePart,
}: Props) {
  const visibleCount = parts.length - hiddenParts.size;
  const existingNames = new Set(parts.map((p) => p.name));
  let n = 1;
  while (existingNames.has(`part${n}`)) n += 1;
  const createSuggested = `part${n}`;

  return (
    <>
      <div className="panel-toolbar">
        <button
          type="button"
          className="btn btn-sm"
          disabled={editsBlocked}
          title={
            editsBlocked
              ? 'Fix the source errors to add parts'
              : 'New part (child of the selected part)'
          }
          onClick={onStartCreate}
        >
          <Plus size={13} />
          New part
        </button>
        <VisibilityButtons
          anyHidden={hiddenParts.size > 0}
          anyShown={visibleCount > 0}
          onShowAll={onShowAll}
          onHideAll={onHideAll}
        />
        <FileRefPicker
          label="Use geometry file"
          files={unreferencedGeometry}
          disabled={manifest === undefined}
          title="Add a geometry file already in this package to the model (SPEC §6.9) — its parts join the rig"
          onPick={onAddGeometryFile}
        />
      </div>
      <div className="panel-scroll">
        <PartTree
          parts={parts}
          partFiles={partFiles}
          manifest={manifest}
          hiddenParts={hiddenParts}
          selectedPart={selectedPart}
          dndEnabled={manifest !== undefined}
          creating={creating}
          createSuggested={createSuggested}
          geometryFiles={geometryFiles}
          validateNewName={(name) =>
            isIdentifier(name) && !existingNames.has(name)
          }
          renameEnabled={!editsBlocked}
          onToggleVisibility={onToggleVisibility}
          onSelectPart={onSelectPart}
          onChangeParent={onChangeParent}
          onConfirmCreate={onConfirmCreate}
          onCancelCreate={onCancelCreate}
          onRenamePart={onRenamePart}
        />
      </div>
    </>
  );
}
