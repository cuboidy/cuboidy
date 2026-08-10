# Cuboidy — C#

The format's second implementation: read a Cuboidy package off disk, and hand
back what a renderer needs — the resolved rig, rest poses, animation sampled at
a time, socket frames, and voxel geometry as vertex data.

Engine-neutral. No `Godot.*`, no `UnityEngine.*`, no engine vector or mesh type
crosses its API; the caller uploads the arrays it is handed and the library
never touches a GPU resource.

```
Cuboidy/          the library; one NuGet package, `Cuboidy`
Cuboidy.Tests/    NUnit; reads ../fixtures/ and ../models/
```

```sh
dotnet build csharp/Cuboidy.sln     # both target frameworks
dotnet test  csharp/Cuboidy.sln
```

`ts/packages/core/` stays the reference. Where the two disagree and the spec is
silent, TypeScript is right and the spec gets the amendment; where the spec is
not silent, the spec is right and TypeScript gets the fix.

**Read `docs/csharp-implementation.md` before changing anything here.** It
carries the scope (what is ported, what is deliberately not, and why), the
porting hazards — places where the literal translation compiles and is wrong —
and the acceptance criterion. Every hazard it lists was measured, and several
of them pass every test written under `en-US`.
