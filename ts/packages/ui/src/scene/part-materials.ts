import type { MeshMaterial } from '@cuboidy/core';
import { MeshStandardMaterial } from 'three';

// three renamed its `Shader` export; taking the parameter type off the hook
// itself keeps this correct whatever the current name is.
type ShaderInfo = Parameters<MeshStandardMaterial['onBeforeCompile']>[0];

// SPEC §7.4 materials → three.js materials, one per bucket `buildMesh`
// emitted. Shared by the live scene and the workspace's thumbnail renderer
// so a library card and the viewport cannot disagree about a finish.
//
// `metallic` and `roughness` map straight onto MeshStandardMaterial —
// unsurprising, since §7.4 named them for glTF's metal-rough workflow and
// three.js implements the same one. `emissive` does not, and the reason is
// worth stating.

// three.js `emissive` is a material-wide COLOR added to the output, and
// §7.4's `emissive` scales the entry's OWN colour. Within one bucket the
// colour varies per vertex, so no uniform colour can express it: setting
// white would wash every glowing voxel toward white instead of making it
// glow its own colour.
//
// The patch below is four lines of GLSL injected after the stock emissive
// chunk, where `diffuseColor` already carries the vertex colour. The
// alternative was one bucket per palette ENTRY rather than per material —
// up to 62 draw calls for a model that wants one.
//
// If a future three.js renames the chunk, this says so instead of quietly
// no longer glowing.
const EMISSIVE_ANCHOR = '#include <emissivemap_fragment>';

function patchEmissive(material: MeshStandardMaterial, strength: number): void {
  material.onBeforeCompile = (shader: ShaderInfo) => {
    if (!shader.fragmentShader.includes(EMISSIVE_ANCHOR)) {
      console.warn(
        `[cuboidy] emissive shader anchor "${EMISSIVE_ANCHOR}" is gone; ` +
          'SPEC §7.4 emissive will not render. three.js chunk renamed?',
      );
      return;
    }
    shader.uniforms['cuboidyEmissive'] = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float cuboidyEmissive;\nvoid main() {')
      .replace(
        EMISSIVE_ANCHOR,
        `${EMISSIVE_ANCHOR}\n\ttotalEmissiveRadiance = diffuseColor.rgb * cuboidyEmissive;`,
      );
  };
  // Two materials differing only in this uniform must not share a compiled
  // program, and three.js keys its cache on the stock parameters alone.
  material.customProgramCacheKey = () => `cuboidy-emissive-${strength}`;
}

export function buildPartMaterials(
  materials: readonly MeshMaterial[],
): MeshStandardMaterial[] {
  return materials.map((m) => {
    const material = new MeshStandardMaterial({
      vertexColors: true,
      metalness: m.metallic,
      roughness: m.roughness,
      transparent: m.translucent,
      // Depth TEST stays on — a translucent face behind something opaque
      // must still be rejected. Only the WRITE is off, so translucent faces
      // do not occlude one another.
      depthWrite: !m.translucent,
    });
    if (m.emissive > 0) patchEmissive(material, m.emissive);
    return material;
  });
}

export function disposeMaterials(
  materials: readonly MeshStandardMaterial[],
): void {
  for (const m of materials) m.dispose();
}
