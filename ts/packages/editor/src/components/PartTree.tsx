import { useMemo, useState, type DragEvent } from 'react';
import {
  buildPartTree,
  descendantNames,
  type PartTreeNode,
} from '../lib/part-tree.js';
import type { Manifest, Part } from '@cuboidy/core';

interface Props {
  parts: readonly Part[];
  manifest: Manifest | undefined;
  hiddenParts: ReadonlySet<string>;
  selectedPart: string | null;
  // D&D parent reassignment is only meaningful when a manifest exists
  // — without one there's nowhere to record the new parent. The tree
  // still renders (flat) so the user sees their parts.
  dndEnabled: boolean;
  onToggleVisibility: (name: string) => void;
  onSelectPart: (name: string | null) => void;
  onChangeParent: (name: string, parent: string | null) => void;
}

type DropTarget = { kind: 'node'; name: string } | { kind: 'root' };

export function PartTree({
  parts,
  manifest,
  hiddenParts,
  selectedPart,
  dndEnabled,
  onToggleVisibility,
  onSelectPart,
  onChangeParent,
}: Props) {
  const tree = useMemo(() => buildPartTree(parts, manifest), [parts, manifest]);
  const [draggingName, setDraggingName] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

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
            hiddenParts={hiddenParts}
            selectedPart={selectedPart}
            dndEnabled={dndEnabled}
            draggingName={draggingName}
            dropTarget={dropTarget}
            forbidden={forbidden}
            onToggleVisibility={onToggleVisibility}
            onSelectPart={onSelectPart}
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
  hiddenParts: ReadonlySet<string>;
  selectedPart: string | null;
  dndEnabled: boolean;
  draggingName: string | null;
  dropTarget: DropTarget | null;
  forbidden: ReadonlySet<string> | null;
  onToggleVisibility: (name: string) => void;
  onSelectPart: (name: string | null) => void;
  onDragStartName: (name: string) => void;
  onDragOverNode: (name: string) => void;
  onDropNode: (name: string) => void;
  onDragEnd: () => void;
}

function PartTreeBranch(props: BranchProps) {
  const {
    node,
    depth,
    hiddenParts,
    selectedPart,
    dndEnabled,
    draggingName,
    dropTarget,
    forbidden,
    onToggleVisibility,
    onSelectPart,
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

  return (
    <li className="part-tree-node" role="treeitem">
      <div
        className={rowClass}
        style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
        draggable={dndEnabled}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          e.stopPropagation();
          onSelectPart(node.name);
        }}
      >
        <input
          type="checkbox"
          className="part-tree-visibility"
          checked={!hidden}
          aria-label={`Toggle visibility of ${node.name}`}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleVisibility(node.name)}
        />
        <span className="part-tree-name">{node.name}</span>
        <span className="part-tree-size">
          {node.cvox.size.w}×{node.cvox.size.h}×{node.cvox.size.d}
        </span>
      </div>
      {node.children.length > 0 && (
        <ul className="part-tree-children" role="group">
          {node.children.map((child) => (
            <PartTreeBranch
              {...props}
              key={child.name}
              node={child}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
