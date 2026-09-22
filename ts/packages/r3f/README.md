# @cuboidy/r3f

[Cuboidy](../../../README.md) models as
[react-three-fiber](https://r3f.docs.pmnd.rs/) components. Everything here
belongs inside a `<Canvas>`: the rigged part tree, the overlays that let one
be picked apart, and the studio a voxel model is meant to be seen in.

It draws nothing itself. Geometry, materials, draw order and SPEC §7.7
placement all come from [`@cuboidy/three`](../three/README.md), so a page
that shows the same model without React gets the same picture. React,
react-three-fiber, drei and three are peers — the app brings its own.

```tsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { buildRigTree } from '@cuboidy/three';
import {
  RiggedParts,
  StudioBackground,
  StudioGrid,
  StudioLighting,
} from '@cuboidy/r3f';

<Canvas>
  <StudioBackground />
  <StudioLighting />
  <StudioGrid min={bounds.min} max={bounds.max} />
  <RiggedParts
    roots={buildRigTree(geometry, manifest)}
    palette={geometry.palette}
    poses={poses}            // null for the rest pose
    hiddenParts={hidden}
    selectedPart={selected}
    gizmos={{ pivot: true, sockets: true, frame: true }}
    onSelectPart={select}
  />
  <OrbitControls />
</Canvas>
```

## What is here

| | |
|---|---|
| `RiggedParts` | The whole model: the rig forest as nested groups, so a parent's animated transform carries its subtree (§6.2). Click-to-select, per-part palettes (§6.13), voxel-tool stroke handlers, and a hook to register each part's group for a transform gizmo |
| `PartMesh` | One part. Splits out because the editor mounts a part on its own in geometry view |
| `PartGizmos` | The selected part's pivot marker, socket markers and bounding frame, and the picking that decides which of them a transform tool is gripping |
| `TransformGizmoHost` | drei's `TransformControls` against a part group, resolving its target from a registry **inside** the canvas — an effect outside it reads a still-empty registry on a remount, and the gizmo then simply never appears |
| `StudioLighting` | The shared rig, declared. Its numbers are `@cuboidy/three`'s, which is also what a plain-three host installs |
| `StudioGrid` | The ground plane, centred on the origin and sized from the model's world bounds. Rig positions are signed, so a grid in the +X +Z quadrant leaves half of some models hanging over nothing |
| `StudioBackground` | What a model is seen against, read from the host's `--bg-0` custom property with a fallback |

## The two types it takes

`GizmoVisibility` and `TransformSubTarget` are props, not state: the app
that mounts these owns both. The editor's wider view vocabulary — view
modes, toolbar tools, voxel edits, timeline selections — stays in
`@cuboidy/ui`, and the workspace deliberately uses neither.
