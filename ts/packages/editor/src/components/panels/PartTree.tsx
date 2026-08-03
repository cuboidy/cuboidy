import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { InlineNameInput } from '@cuboidy/ui';
import { buildPartTree, descendantNames, type PartTreeNode } from '../../lib/part-tree.js';
import { pathBasename } from '../../lib/source-ops.js';
import type { Manifest, Part } from '@cuboidy/core';

interface Props {
  parts: readonly Part[];
  // Defining geometry file per part (v0.7 multi-geometry). Present only when
  // the model spans more than one file — each row then shows a faint
  // file badge at its right so cross-file rigs stay legible.
  partFiles?: ReadonlyMap<string, string> | undefined;
  manifest: Manifest | undefined;
  hiddenParts: ReadonlySet<string>;
  selectedPart: string | null;
  // D&D parent reassignment is only meaningful when a manifest exists
  // — without one there's nowhere to record the new parent. The tree
  // still renders (flat) so the user sees their parts.
  dndEnabled: boolean;
  // In-progress inline "new part" draft (VS Code-style). Non-null renders an
  // editable name row nested under `creating.parent` (null = root); the caller
  // creates the part on confirm.
  creating: { parent: string | null } | null;
  createSuggested: string;
  // Geometry files a new part may be created in, geometry-list order
  // (first = primary). Present only when the model spans more than one
  // file — the draft row then shows a target-file picker, defaulting to
  // the parent part's defining file (root drafts: the primary).
  geometryFiles?: readonly string[] | undefined;
  validateNewName: (name: string) => boolean;
  // Inline rename is disabled while geometry/manifest have syntax errors (a rewrite
  // would clobber the in-progress text).
  renameEnabled: boolean;
  onToggleVisibility: (name: string) => void;
  onSelectPart: (name: string | null) => void;
  onChangeParent: (name: string, parent: string | null) => void;
  // `file` is the picker choice (undefined = single-file model; the
  // caller falls back to the primary).
  onConfirmCreate: (name: string, file?: string) => void;
  onCancelCreate: () => void;
  onRenamePart: (oldName: string, newName: string) => void;
}

type DropTarget = { kind: 'node'; name: string } | { kind: 'root' };

export function PartTree({
  parts,
  partFiles,
  manifest,
  hiddenParts,
  selectedPart,
  dndEnabled,
  creating,
  createSuggested,
  geometryFiles,
  validateNewName,
  renameEnabled,
  onToggleVisibility,
  onSelectPart,
  onChangeParent,
  onConfirmCreate,
  onCancelCreate,
  onRenamePart,
}: Props) {
  const tree = useMemo(() => buildPartTree(parts, manifest), [parts, manifest]);
  const [draggingName, setDraggingName] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // Name of the part whose row is currently in inline-rename mode, or null.
  const [renaming, setRenaming] = useState<string | null>(null);
  const startRename = (name: string): void => {
    if (renameEnabled) setRenaming(name);
  };
  const cancelRename = (): void => setRenaming(null);
  const commitRename = (oldName: string, newName: string): void => {
    onRenamePart(oldName, newName);
    setRenaming(null);
  };
  // Names of nodes whose children are hidden. Absent = expanded (the default),
  // so a freshly loaded tree shows everything.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleExpand = (name: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // If a draft opens under a collapsed parent, expand it (and keep it expanded
  // after the part is created) so the new child doesn't vanish on confirm.
  useEffect(() => {
    const parent = creating?.parent;
    if (parent === undefined || parent === null) return;
    setCollapsed((prev) => {
      if (!prev.has(parent)) return prev;
      const next = new Set(prev);
      next.delete(parent);
      return next;
    });
  }, [creating]);

  // While dragging, descendants of the dragged node (including itself)
  // are forbidden as drop targets — reassigning to one would create a
  // cycle. Compute once per drag rather than per dragover event.
  const forbidden = useMemo(() => {
    if (draggingName === null) return null;
    return descendantNames(tree, draggingName);
  }, [tree, draggingName]);

  const endDrag = () => {
    setDraggingName(null);
    setDropTarget(null);
  };

  const commitDrop = (target: DropTarget) => {
    if (draggingName === null) return;
    if (target.kind === 'node' && target.name === draggingName) return;
    if (target.kind === 'node' && forbidden?.has(target.name) === true) return;
    const newParent = target.kind === 'node' ? target.name : null;
    onChangeParent(draggingName, newParent);
  };

  return (
    <div
      className="part-tree"
      // Treat clicks on background (not on a row) as a deselect — this
      // is the keyboard-free way to clear selection. Stopping props on
      // rows themselves keeps a row-click from also firing this.
      onClick={() => onSelectPart(null)}
    >
      <ul className="tree-list" role="tree">
        {tree.map((node) => (
          <PartTreeBranch
            key={node.name}
            node={node}
            depth={0}
            partFiles={partFiles}
            hiddenParts={hiddenParts}
            selectedPart={selectedPart}
            dndEnabled={dndEnabled}
            draggingName={draggingName}
            dropTarget={dropTarget}
            forbidden={forbidden}
            collapsed={collapsed}
            creating={creating}
            createSuggested={createSuggested}
            geometryFiles={geometryFiles}
            validateNewName={validateNewName}
            renaming={renaming}
            onToggleExpand={toggleExpand}
            onToggleVisibility={onToggleVisibility}
            onSelectPart={onSelectPart}
            onConfirmCreate={onConfirmCreate}
            onCancelCreate={onCancelCreate}
            onStartRename={startRename}
            onCancelRename={cancelRename}
            onCommitRename={commitRename}
            onDragStartName={(name) => {
              setDraggingName(name);
              setDropTarget(null);
            }}
            onDragOverNode={(name) => {
              if (draggingName === null) return;
              if (name === draggingName) return;
              if (forbidden?.has(name) === true) return;
              setDropTarget({ kind: 'node', name });
            }}
            onDropNode={(name) => {
              commitDrop({ kind: 'node', name });
              endDrag();
            }}
            onDragEnd={endDrag}
          />
        ))}
        {creating?.parent === null && (
          <DraftPartRow
            depth={0}
            suggested={createSuggested}
            validate={validateNewName}
            files={geometryFiles}
            defaultFile={geometryFiles?.[0]}
            onConfirm={onConfirmCreate}
            onCancel={onCancelCreate}
          />
        )}
      </ul>
      {dndEnabled && (
        <div
          className={`part-tree-root-dropzone${
            dropTarget?.kind === 'root' ? ' active' : ''
          }${draggingName !== null ? ' visible' : ''}`}
          onDragOver={(e) => {
            if (draggingName === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropTarget({ kind: 'root' });
          }}
          onDragLeave={() => {
            if (dropTarget?.kind === 'root') setDropTarget(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            commitDrop({ kind: 'root' });
            endDrag();
          }}
        >
          Drop here to unparent
        </div>
      )}
    </div>
  );
}

interface BranchProps {
  node: PartTreeNode;
  depth: number;
  partFiles?: ReadonlyMap<string, string> | undefined;
  hiddenParts: ReadonlySet<string>;
  selectedPart: string | null;
  dndEnabled: boolean;
  draggingName: string | null;
  dropTarget: DropTarget | null;
  forbidden: ReadonlySet<string> | null;
  collapsed: ReadonlySet<string>;
  creating: { parent: string | null } | null;
  createSuggested: string;
  geometryFiles?: readonly string[] | undefined;
  validateNewName: (name: string) => boolean;
  renaming: string | null;
  onToggleExpand: (name: string) => void;
  onToggleVisibility: (name: string) => void;
  onSelectPart: (name: string | null) => void;
  onConfirmCreate: (name: string, file?: string) => void;
  onCancelCreate: () => void;
  onStartRename: (name: string) => void;
  onCancelRename: () => void;
  onCommitRename: (oldName: string, newName: string) => void;
  onDragStartName: (name: string) => void;
  onDragOverNode: (name: string) => void;
  onDropNode: (name: string) => void;
  onDragEnd: () => void;
}

function PartTreeBranch(props: BranchProps) {
  const {
    node,
    depth,
    partFiles,
    hiddenParts,
    selectedPart,
    dndEnabled,
    draggingName,
    dropTarget,
    forbidden,
    collapsed,
    creating,
    createSuggested,
    geometryFiles,
    validateNewName,
    renaming,
    onToggleExpand,
    onToggleVisibility,
    onSelectPart,
    onConfirmCreate,
    onCancelCreate,
    onStartRename,
    onCancelRename,
    onCommitRename,
    onDragStartName,
    onDragOverNode,
    onDropNode,
    onDragEnd,
  } = props;

  const hidden = hiddenParts.has(node.name);
  const selected = selectedPart === node.name;
  const isDropTarget =
    dropTarget?.kind === 'node' && dropTarget.name === node.name;
  const isForbiddenTarget =
    draggingName !== null &&
    (forbidden?.has(node.name) === true || node.name === draggingName);

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled) return;
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers refuse to start a drag without payload set.
    e.dataTransfer.setData('text/plain', node.name);
    onDragStartName(node.name);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled || draggingName === null) return;
    if (isForbiddenTarget) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    onDragOverNode(node.name);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled || draggingName === null) return;
    if (isForbiddenTarget) return;
    e.preventDefault();
    e.stopPropagation();
    onDropNode(node.name);
  };

  const rowClass = [
    'tree-row',
    hidden ? 'hidden' : '',
    selected ? 'selected' : '',
    isDropTarget ? 'drop-target' : '',
    isForbiddenTarget ? 'drop-forbidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const isCreateHere = creating?.parent === node.name;
  const hasChildren = node.children.length > 0 || isCreateHere;
  // A create-in-progress forces its parent open so the draft row is visible.
  const expanded = !collapsed.has(node.name) || isCreateHere;
  const isRenaming = renaming === node.name;

  return (
    <li className="tree-node" role="treeitem">
      <div
        className={rowClass}
        style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
        draggable={dndEnabled && !isRenaming}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          e.stopPropagation();
          onSelectPart(node.name);
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="tree-caret-btn"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.name);
            }}
          >
            <span className="tree-caret">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          </button>
        ) : (
          <span className="tree-caret-spacer" aria-hidden="true" />
        )}
        {isRenaming ? (
          <InlineNameInput
            initial={node.name}
            ariaLabel={`Rename ${node.name}`}
            validate={(name) => name === node.name || validateNewName(name)}
            onCommit={(name) => onCommitRename(node.name, name)}
            onCancel={onCancelRename}
          />
        ) : (
          <span
            className="tree-name"
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartRename(node.name);
            }}
          >
            {node.name}
          </span>
        )}
        {partFiles?.has(node.name) === true && (
          <span className="part-tree-file" title={partFiles.get(node.name)}>
            {pathBasename(partFiles.get(node.name)!)}
          </span>
        )}
        <button
          type="button"
          className="tree-action"
          aria-label={`${hidden ? 'Show' : 'Hide'} ${node.name}`}
          aria-pressed={hidden}
          title={hidden ? 'Show part' : 'Hide part'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(node.name);
          }}
        >
          {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {hasChildren && expanded && (
        <ul className="tree-list" role="group">
          {node.children.map((child) => (
            <PartTreeBranch
              {...props}
              key={child.name}
              node={child}
              depth={depth + 1}
            />
          ))}
          {isCreateHere && (
            <DraftPartRow
              depth={depth + 1}
              suggested={createSuggested}
              validate={validateNewName}
              files={geometryFiles}
              defaultFile={partFiles?.get(node.name) ?? geometryFiles?.[0]}
              onConfirm={onConfirmCreate}
              onCancel={onCancelCreate}
            />
          )}
        </ul>
      )}
    </li>
  );
}

// Draft row for creating a part — a caret spacer keeps its input aligned
// with the other rows' names. The name field is the shared
// InlineNameInput in composite mode: the optional target-file picker
// rides as `trailing`, so Enter commits from either control and only
// focus leaving the whole row cancels. This row owns just the picker's
// value.
function DraftPartRow({
  depth,
  suggested,
  validate,
  files,
  defaultFile,
  onConfirm,
  onCancel,
}: {
  depth: number;
  suggested: string;
  validate: (name: string) => boolean;
  // Target-file choices, geometry-list order. undefined = single-file
  // model; no picker is shown and the commit passes file = undefined.
  files?: readonly string[] | undefined;
  defaultFile?: string | undefined;
  onConfirm: (name: string, file?: string) => void;
  onCancel: () => void;
}) {
  const [file, setFile] = useState(defaultFile);

  return (
    <li className="tree-node" role="treeitem">
      <div
        className="tree-row draft"
        style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="tree-caret-spacer" aria-hidden="true" />
        <InlineNameInput
          initial={suggested}
          ariaLabel="New part name"
          validate={validate}
          onCommit={(name) => onConfirm(name, file)}
          onCancel={onCancel}
          trailing={
            files !== undefined ? (
              <select
                className="part-tree-draft-file"
                value={file}
                aria-label="File to create the part in"
                title="Which geometry file the new part is written to"
                onChange={(e) => setFile(e.target.value)}
              >
                {files.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            ) : undefined
          }
        />
      </div>
    </li>
  );
}
