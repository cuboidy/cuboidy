# Diagnostic models

Models built to isolate one rendering question at a time. Deliberately NOT
under `models/`: that directory is the shipped gallery and the positive half
of the cross-implementation contract (`corpus-coverage.test.ts` asserts
properties of it), and these are throwaway probes with no business being part
of what a second implementation must reproduce.

Load one the same way as any model — `cuboidy-snap models-test/<name>`, or
drop the folder on the editor.

## `translucency/`

Four cases side by side, each five voxels tall, each its own part so the
editor's Parts panel can hide them one at a time:

| part | what it isolates |
|---|---|
| `single-A` | one translucent column. Any line inside it means same-colour internal faces are being drawn — they should be culled |
| `pair-same-AA` | two columns of ONE translucent colour. A visible division between them means the same-index cull is not working |
| `pair-diff-AB` | two columns of DIFFERENT translucent colours. The interface between them is the case under discussion |
| `opaque-ref` | an opaque column, for comparison |

Look from below at a shallow angle — the interface plane is edge-on from the
front and from directly above, so the artifact only appears when a line of
sight crosses it.
