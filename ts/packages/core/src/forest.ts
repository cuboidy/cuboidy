// Cycle-safe hierarchy resolution: items that name a parent by id become a
// tree, and an edge that would close a cycle is dropped so its item stays a
// root. The rig view (parts naming parents), the world-transform chain and
// the workspace's scene tree (instances naming hosts) all need it, because
// malformed input — a hand-edited file, a not-yet-rejected manifest — must
// not hang a renderer or make both members of a cycle silently vanish.
//
// This is the LENIENT policy, and it is one policy in one place. The strict
// counterpart is `ManifestSchema`'s refinement, which rejects the same
// shapes with §11.5 diagnostics; validation and display want different
// answers and always will. What they must not have is different answers to
// "who is this part's parent" — `computeWorldTransforms` used to carry its
// own walk that resolved a self-parent by applying its transform TWICE and
// left a phantom entry in its output map for every parent that named no
// part.

export interface ForestNode<T> {
  value: T;
  children: ForestNode<T>[];
}

// Why an item's declared parent was not used.
export type DroppedEdge = 'self' | 'unknown' | 'cycle';

export interface Hierarchy {
  // Effective parent per id: absent from the map, or undefined, when the
  // item is a root. Every chain of these terminates.
  parentOf: ReadonlyMap<string, string | undefined>;
  // Ids whose declared parent was dropped, and why. Renderers ignore this;
  // a reporting layer can say which edge it lost.
  dropped: ReadonlyMap<string, DroppedEdge>;
  // Ids in an order where every item follows its effective parent, stable
  // with respect to input order. A caller composing transforms down the
  // chain can walk this once instead of recursing.
  order: readonly string[];
}

export function resolveHierarchy<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  parentOf: (item: T) => string | undefined,
): Hierarchy {
  // First id wins, matching every other by-name lookup in the codebase.
  const declared = new Map<string, string | undefined>();
  const ids: string[] = [];
  for (const item of items) {
    const id = idOf(item);
    if (declared.has(id)) continue;
    declared.set(id, parentOf(item));
    ids.push(id);
  }

  const effective = new Map<string, string | undefined>();
  const dropped = new Map<string, DroppedEdge>();
  for (const id of ids) {
    const parent = declared.get(id);
    if (parent === undefined) {
      effective.set(id, undefined);
      continue;
    }
    if (parent === id) {
      effective.set(id, undefined);
      dropped.set(id, 'self');
      continue;
    }
    if (!declared.has(parent)) {
      effective.set(id, undefined);
      dropped.set(id, 'unknown');
      continue;
    }
    // Walking up from the proposed parent must terminate; revisiting `id`
    // means this edge closes a cycle, so drop THIS edge and let the item be
    // a root. Which member of a cycle becomes the root therefore depends on
    // input order — that is inherent to breaking a cycle, and it is why
    // validation rejects them rather than leaving it to the renderer.
    const seen = new Set<string>([id]);
    let cur: string | undefined = parent;
    let closes = false;
    while (cur !== undefined) {
      if (seen.has(cur)) {
        closes = true;
        break;
      }
      seen.add(cur);
      cur = declared.get(cur);
    }
    if (closes) {
      effective.set(id, undefined);
      dropped.set(id, 'cycle');
    } else {
      effective.set(id, parent);
    }
  }

  const order: string[] = [];
  const placed = new Set<string>();
  const place = (id: string): void => {
    if (placed.has(id)) return;
    const parent = effective.get(id);
    if (parent !== undefined) place(parent);
    placed.add(id);
    order.push(id);
  };
  for (const id of ids) place(id);

  return { parentOf: effective, dropped, order };
}

export function buildForest<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  parentOf: (item: T) => string | undefined,
): ForestNode<T>[] {
  const { parentOf: effective } = resolveHierarchy(items, idOf, parentOf);
  const nodes = new Map<string, ForestNode<T>>();
  for (const item of items) nodes.set(idOf(item), { value: item, children: [] });

  const roots: ForestNode<T>[] = [];
  for (const item of items) {
    const id = idOf(item);
    const node = nodes.get(id)!;
    const parent = effective.get(id);
    if (parent === undefined) roots.push(node);
    else nodes.get(parent)!.children.push(node);
  }
  return roots;
}
