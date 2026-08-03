import { buildForest, type ForestNode } from '@cuboidy/core';
import type { PlacedInstance } from './scene-resolve.js';

// The two trees the panels derive from a placed scene: the Instances
// panel's rows (nested by what the scene CLAIMS) and the 3D view's
// nesting (by what actually RESOLVED). View-shaped code — PanelRow.key
// is literally a React key — kept beside the resolution it consumes.

// A guest under its host.
export interface SceneNode {
  placed: PlacedInstance;
  children: SceneNode[];
}

// A row in the Instances panel. Sockets are rows of their own, between a
// host and whatever hangs off it:
//
//   knight            instance
//     weapon          socket
//       sword         instance
//     crest           socket, empty
//
// Three things fall out of that. An empty socket becomes visible, so what
// a model OFFERS (§6.12) can be read without opening another panel.
// Changing which socket something hangs from becomes a drag onto the
// socket row, instead of a dropdown in a different panel. And every
// instance can carry the same icon — before, a model got a different
// glyph depending on whether it happened to be attached, which made the
// icon say where a row SAT rather than what it WAS.
export type PanelRow =
  | {
      kind: 'instance';
      // Stable React key. Instance ids and socket names live in different
      // namespaces and could collide.
      key: string;
      placed: PlacedInstance;
      children: PanelRow[];
    }
  | {
      kind: 'socket';
      key: string;
      host: string;
      socket: string;
      // False when the host does not (or no longer) publishes it, but
      // something in the scene is attached to that name anyway. The row
      // exists so the guest under it has somewhere to be.
      published: boolean;
      // What the published name resolves to, `part:socket` (§6.12).
      // Undefined for an unpublished one. This is the fact the tree could
      // not otherwise carry — the published name is the contract, but
      // when a socket is in the wrong PLACE this is what says which part
      // to go and fix.
      target?: string;
      children: PanelRow[];
    };

export function panelTree(placed: readonly PlacedInstance[]): PanelRow[] {
  // Nested by what the scene CLAIMS, not by what resolved: a guest whose
  // socket has gone missing still belongs under the host it names, or the
  // problem has nothing to sit against.
  const instances = buildTree(placed, (p) => p.instance.attach?.to);
  return instances.map(toPanelRow);
}

function toPanelRow(node: SceneNode): PanelRow {
  const host = node.placed.instance.id;
  const map = node.placed.model.manifest.sockets ?? {};
  const published = Object.keys(map);
  // Every published socket gets a row, plus any name a guest claims that
  // the host does not publish — appended, so the model's own order (which
  // the author chose) is not disturbed by a broken reference.
  const claimed = node.children.map((c) => c.placed.instance.attach?.socket);
  const extra = [
    ...new Set(
      claimed.filter(
        (s): s is string => s !== undefined && !published.includes(s),
      ),
    ),
  ];

  const rows: PanelRow[] = [...published, ...extra].map((socket) => {
    const to = map[socket];
    return {
      kind: 'socket',
      key: `sock:${host}/${socket}`,
      host,
      socket,
      published: published.includes(socket),
      ...(to !== undefined && { target: `${to.part}:${to.socket}` }),
      children: node.children
        .filter((c) => c.placed.instance.attach?.socket === socket)
        .map(toPanelRow),
    };
  });

  return {
    kind: 'instance',
    key: `inst:${host}`,
    placed: node.placed,
    children: rows,
  };
}

// The tree the 3D view draws, nested by what actually RESOLVED.
//
// A guest is a real child of its host's group, which is what makes it
// follow while the host is dragged: a transform gizmo mutates one group's
// matrix imperatively, and a sibling would simply not hear about it until
// the drag committed and the whole scene re-resolved.
//
// An UNRESOLVED attachment is left at the root, because placeScene draws
// it at its own placement in world space; hanging it off the host would
// move it somewhere nothing asked for.
export function drawTree(placed: readonly PlacedInstance[]): SceneNode[] {
  return buildTree(placed, (p) =>
    p.attachAt === null ? undefined : p.instance.attach?.to,
  );
}

// Through core's cycle-safe buildForest. setAttachment refuses a cycle,
// but a hand-edited scene file is not required to — and a cycle would
// leave BOTH instances as somebody's child and neither in the roots,
// i.e. silently absent from the panel and (now that the 3D view nests
// too) from the screen.
function buildTree(
  placed: readonly PlacedInstance[],
  hostOf: (p: PlacedInstance) => string | undefined,
): SceneNode[] {
  const toNode = (n: ForestNode<PlacedInstance>): SceneNode => ({
    placed: n.value,
    children: n.children.map(toNode),
  });
  return buildForest(placed, (p) => p.instance.id, hostOf).map(toNode);
}
