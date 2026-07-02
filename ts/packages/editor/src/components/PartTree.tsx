import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import {
  buildPartTree,
  descendantNames,
  type PartTreeNode,
} from '../lib/part-tree.js';
import type { Manifest, Part } from '@cuboidy/core';

interface Props {
  parts: readonly Part[];
  // Defining geometry file per part (v0.7 multi-cvox). Present only when
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
  validateNewName: (name: string) => boolean;
  // Inline rename is disabled while cvox/manifest have syntax errors (a rewrite
  // would clobber the in-progress text).
  renameEnabled: boolean;
  onToggleVisibility: (name: string) => void;
  onSelectPart: (name: string | null) => void;
  onChangeParent: (name: string, parent: string | null) => void;
  onConfirmCreate: (name: string) => void;
  onCancelCreate: () => void;
  onRenamePart: (oldName: string, newName: string) => void;
}

type DropTarget = { kind: 'node'; name: string } | { kind: 'root' };

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function PartTree({
  parts,
  partFiles,
  manifest,
  hiddenParts,
  selectedPart,
  dndEnabled,
  creating,
  createSuggested,
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
      <ul className="part-tree-root" role="tree">
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
  validateNewName: (name: string) => boolean;
  renaming: string | null;
  onToggleExpand: (name: string) => void;
  onToggleVisibility: (name: string) => void;
  onSelectPart: (name: string | null) => void;
  onConfirmCreate: (name: string) => void;
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
    'part-tree-row',
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
    <li className="part-tree-node" role="treeitem">
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
            className="part-tree-caret-btn"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.name);
            }}
          >
            <span className="part-tree-caret">{expanded ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span className="part-tree-caret-spacer" aria-hidden="true" />
        )}
        {isRenaming ? (
          <PartNameInput
            initial={node.name}
            ariaLabel={`Rename ${node.name}`}
            validate={(name) => name === node.name || validateNewName(name)}
            onCommit={(name) => onCommitRename(node.name, name)}
            onCancel={onCancelRename}
          />
        ) : (
          <span
            className="part-tree-name"
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
            {basename(partFiles.get(node.name)!)}
          </span>
        )}
        <input
          type="checkbox"
          className="part-tree-visibility"
          checked={!hidden}
          aria-label={`Toggle visibility of ${node.name}`}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleVisibility(node.name)}
        />
      </div>
      {hasChildren && expanded && (
        <ul className="part-tree-children" role="group">
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
              onConfirm={onConfirmCreate}
              onCancel={onCancelCreate}
            />
          )}
        </ul>
      )}
    </li>
  );
}

// Shared inline text field for naming a part — the create draft and the rename
// edit both use it. Auto-focuses and selects its text; Enter commits a valid,
// non-empty name; Escape or blurring away (clicking elsewhere) cancels — so an
// accidental click never commits. Invalid names flash red and keep the field
// open. A `done` latch keeps the unmount-blur from firing after Enter/Escape
// already resolved it.
function PartNameInput({
  initial,
  ariaLabel,
  validate,
  onCommit,
  onCancel,
}: {
  initial: string;
  ariaLabel: string;
  validate: (name: string) => boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (el !== null) {
      el.focus();
      el.select();
    }
  }, []);

  const finish = (commit: boolean): void => {
    if (done.current) return;
    if (!commit) {
      done.current = true;
      onCancel();
      return;
    }
    const next = text.trim();
    if (next === '') {
      done.current = true;
      onCancel();
      return;
    }
    if (!validate(next)) {
      setInvalid(true);
      return;
    }
    done.current = true;
    onCommit(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };

  return (
    <input
      ref={ref}
      type="text"
      className={`part-tree-name-input${invalid ? ' invalid' : ''}`}
      value={text}
      aria-label={ariaLabel}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(false);
      }}
      onKeyDown={handleKeyDown}
      onBlur={() => finish(false)}
      onAnimationEnd={() => setInvalid(false)}
    />
  );
}

// Draft row for creating a part — a caret spacer keeps its input aligned with
// the other rows' names.
function DraftPartRow({
  depth,
  suggested,
  validate,
  onConfirm,
  onCancel,
}: {
  depth: number;
  suggested: string;
  validate: (name: string) => boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <li className="part-tree-node" role="treeitem">
      <div
        className="part-tree-row part-tree-draft"
        style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="part-tree-caret-spacer" aria-hidden="true" />
        <PartNameInput
          initial={suggested}
          ariaLabel="New part name"
          validate={validate}
          onCommit={onConfirm}
          onCancel={onCancel}
        />
      </div>
    </li>
  );
}
