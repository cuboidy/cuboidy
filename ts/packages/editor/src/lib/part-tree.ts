import type { Manifest, Part } from '@cuboidy/core';

// Tree shape rendered by the Parts panel. Source-of-truth for which
// parts exist is `cvox.parts` (the actual voxel data); hierarchy is
// derived from `manifest.parts` parent references when a manifest is
// loaded. Parts that exist in cvox but have no manifest entry (or
// reference a non-existent parent) collapse to root level — that way
// the tree always shows every renderable part even when the manifest
// is missing or only partially populated.

export interface PartTreeNode {
  name: string;
  cvox: Part;
  children: PartTreeNode[];
}

export function buildPartTree(
  cvoxParts: readonly Part[],
  manifest: Manifest | undefined,
): PartTreeNode[] {
  const partByName = new Map(cvoxParts.map((p) => [p.name, p] as const));

  // Resolve each cvox part's parent name: take it from the matching
  // manifest entry when present and the named parent also exists as a
  // cvox part. Anything else (no manifest, no matching entry, dangling
  // parent ref) becomes a root.
  const parentByName = new Map<string, string | null>();
  for (const cp of cvoxParts) {
    parentByName.set(cp.name, null);
  }
  if (manifest !== undefined) {
    for (const mp of manifest.parts) {
      if (!partByName.has(mp.name)) continue;
      const p = mp.parent;
      if (p !== undefined && partByName.has(p) && p !== mp.name) {
        parentByName.set(mp.name, p);
      }
    }
  }

  // Cycle break: walk each part's parent chain and reset to root if a
  // cycle is detected. Manifest parser doesn't enforce acyclicity, so
  // we defend here rather than recurse forever during tree build.
  for (const cp of cvoxParts) {
    const seen = new Set<string>([cp.name]);
    let cursor: string | null = parentByName.get(cp.name) ?? null;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        parentByName.set(cp.name, null);
        break;
      }
      seen.add(cursor);
      cursor = parentByName.get(cursor) ?? null;
    }
  }

  const childrenByParent = new Map<string | null, string[]>();
  for (const cp of cvoxParts) {
    const parent = parentByName.get(cp.name) ?? null;
    const bucket = childrenByParent.get(parent);
    if (bucket === undefined) childrenByParent.set(parent, [cp.name]);
    else bucket.push(cp.name);
  }

  const build = (name: string): PartTreeNode => ({
    name,
    cvox: partByName.get(name)!,
    children: (childrenByParent.get(name) ?? []).map(build),
  });

  return (childrenByParent.get(null) ?? []).map(build);
}

// Names of `name` and all its descendants in the tree. Used by D&D to
// reject drops that would create a cycle: when dragging `X`, neither
// `X` nor any descendant of `X` is a legal parent target.
export function descendantNames(
  tree: readonly PartTreeNode[],
  name: string,
): Set<string> {
  const result = new Set<string>();
  const visit = (nodes: readonly PartTreeNode[]): boolean => {
    for (const n of nodes) {
      if (n.name === name) {
        collect(n);
        return true;
      }
      if (visit(n.children)) return true;
    }
    return false;
  };
  const collect = (node: PartTreeNode): void => {
    result.add(node.name);
    for (const c of node.children) collect(c);
  };
  visit(tree);
  return result;
}

// Returns the manifest's part entry for `name`, or undefined if the
// manifest doesn't list this part. Callers typically need this to read
// `position` / `parent` for property panels.
export function findManifestPart(manifest: Manifest, name: string) {
  return manifest.parts.find((p) => p.name === name);
}
