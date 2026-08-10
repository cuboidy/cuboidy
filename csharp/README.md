# Cuboidy — C#

The format's second implementation: read a Cuboidy package off disk, and hand
back what a renderer needs — the resolved rig, rest poses, animation sampled at
a time, socket frames, and voxel geometry as vertex data.

Engine-neutral. No `Godot.*`, no `UnityEngine.*`, no engine vector or mesh type
crosses its API; the caller uploads the arrays it is handed and the library
never touches a GPU resource.

```
Cuboidy/          the library; one NuGet package, `Cuboidy`
Cuboidy.Tests/    NUnit; reads ../fixtures/, ../models/ and parity/
```

```sh
dotnet build csharp/Cuboidy.sln     # netstandard2.1 and net8.0
dotnet test  csharp/Cuboidy.sln
```

## Using it

```csharp
using Cuboidy;
using Cuboidy.Runtime;

Result<CuboidyModel> loaded = CuboidyModel.Load("models/knight");
if (!loaded.Ok) return;                  // the manifest is absent or invalid
CuboidyModel model = loaded.Value;
if (!model.Resolved) { /* §11.6: some part has no shape — check Project */ }

// Upload once, in PART-LOCAL space.
foreach (Placement p in model.Placements())
{
    MeshData mesh = model.BuildMesh(p.Name);   // p.Pivot is what it is measured from
}

// Per frame.
OrderedMap<Pose> poses = model.Pose("walk", seconds);
foreach (Placement p in model.Placements(poses))
{
    // p.World.Pos / p.World.Quat place the part; p.Scale applies about
    // p.Pivot and does NOT propagate to children (§7.7); p.Visible decides
    // whether to draw it. p.ToWorld(v) does all of it for one local point.
}

Frame? hand = model.PublishedSocketFrame("weapon", poses);   // §6.12
```

Two things the API exists to stop a caller from getting wrong: `BuildMesh`
takes the part's OWN palette (merging is a CLI concern), and the mesh is
part-local, so scale is applied per part rather than folded into the transform.

## Reading it

`ts/packages/core/` stays the reference. Where the two disagree and the spec is
silent, TypeScript is right and the spec gets the amendment; where the spec is
not silent, the spec is right and TypeScript gets the fix.

**Read `docs/csharp-implementation.md` before changing anything here.** It
carries the scope (what is ported, what is deliberately not, and why), the
porting hazards — places where the literal translation compiles and is wrong —
and the acceptance criterion. Every hazard it lists was measured, and several
of them pass every test written under `en-US`.

## How it is checked

- **`fixtures/`** — the negative corpus. 47 documents, each reporting the
  §11.2 code its directory is named after, plus two packages that must not
  resolve (§11.6).
- **`models/`** — the positive half. All nine load clean and fully resolved.
- **`parity/runtime.txt`** and **`parity/mesh.txt`** — `cuboidy-query`'s own
  output over every model, every clip, and 27 sample times per clip
  (`k·duration/24` for `k = -1 … 25`). The rig lines are compared as parsed
  doubles with a 2e-6 tolerance; the mesh lines exactly. Regenerate with
  `npm run -w @cuboidy/core dump:parity`.

The face-level form (`--mesh-faces`, 1,108,465 lines) is not committed. It was
generated on both sides once and matched byte for byte, which is what makes the
committed digest a usable stand-in. If a digest ever moves, regenerate that
form on both sides and diff it — do not relax the comparison.

The standing advice from the two audits that preceded this port: **do not ask
whether it passes, ask what it could get wrong and still pass.** Every chunk
here was finished by breaking it on purpose and counting the tests that noticed.
