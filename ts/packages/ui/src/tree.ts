// Shared bits of the three trees — the editor's Parts and Files panels and
// the workspace's Scene panel — which already share `tree.css` and so are
// already obliged to agree about layout.
//
// This is deliberately NOT a tree component. The three differ in the parts
// that are genuinely theirs: what a row contains, what a drag means, what a
// drop does. What they must not differ in is the geometry, because they are
// styled by one stylesheet and a row indented differently in one of them is
// simply wrong.

// Left padding for a row at `depth`, matching `tree.css`'s caret and icon
// sizing. Was written out at six call sites across three files; the
// constants have to move together with the stylesheet, and six copies is
// six chances for one of them not to.
export function treeIndent(depth: number): string {
  return `${TREE_INDENT_BASE + depth * TREE_INDENT_STEP}rem`;
}

const TREE_INDENT_BASE = 0.5;
const TREE_INDENT_STEP = 0.9;
