// Cycle-safe forest building: items that name a parent by id become a
// tree, and an edge that would close a cycle is dropped so its item
// stays a root. The rig view (parts naming parents) and the workspace's
// scene tree (instances naming hosts) carried the same walk verbatim —
// and both need it, because malformed input (a hand-edited file, a
// not-yet-rejected manifest) must not hang the renderer or make both
// members of a cycle silently vanish from the roots.

export interface ForestNode<T> {
  value: T;
  children: ForestNode<T>[];
}

export function buildForest<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  parentOf: (item: T) => string | undefined,
): ForestNode<T>[] {
  const nodes = new Map<string, ForestNode<T>>();
  const parents = new Map<string, string | undefined>();
  for (const item of items) {
    const id = idOf(item);
    nodes.set(id, { value: item, children: [] });
    parents.set(id, parentOf(item));
  }

  // A parent that is absent, unknown or self-referential makes the item
  // a root; walking up from a proposed parent must terminate, and a
  // revisit means this edge would close a cycle — drop it.
  const effectiveParent = (id: string): string | undefined => {
    const parent = parents.get(id);
    if (parent === undefined || parent === id || !nodes.has(parent)) {
      return undefined;
    }
    const seen = new Set<string>([id]);
    let cur: string | undefined = parent;
    while (cur !== undefined && nodes.has(cur)) {
      if (seen.has(cur)) return undefined;
      seen.add(cur);
      cur = parents.get(cur);
    }
    return parent;
  };

  const roots: ForestNode<T>[] = [];
  for (const item of items) {
    const id = idOf(item);
    const node = nodes.get(id)!;
    const parent = effectiveParent(id);
    if (parent === undefined) roots.push(node);
    else nodes.get(parent)!.children.push(node);
  }
  return roots;
}
