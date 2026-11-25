import type * as THREE from 'three'

/**
 * Frees every GPU resource under a scene root: geometries, materials, the
 * textures the materials hold, and shadow maps. The CPU-side graph survives —
 * typed arrays and image sources stay usable, and three.js re-uploads lazily
 * on the next render. Used both for suspend (GPU-only, spec §4.1 v1 shortcut)
 * and inside full teardown.
 *
 * Each geometry, material and texture is freed once, however many meshes or
 * materials share it. A texture is any texture-valued property of a material
 * (map, normalMap, roughnessMap, … and whatever else a material type adds), or
 * a ShaderMaterial uniform's value.
 */
export function disposeSceneGraph(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((obj) => {
    // meshes, lines (segments and loops too) and points: whatever draws a geometry with a material
    const drawn = obj as THREE.Mesh
    if (drawn.isMesh || (obj as THREE.Line).isLine || (obj as THREE.Points).isPoints) {
      if (drawn.geometry) geometries.add(drawn.geometry)
      const material = drawn.material
      for (const m of Array.isArray(material) ? material : [material]) if (m) materials.add(m)
    }
    const light = obj as THREE.DirectionalLight
    if (light.isLight && light.shadow) {
      light.shadow.dispose()
      // three only reallocates the shadow render target when map is null
      light.shadow.map = null
    }
  })
  const textures = new Set<THREE.Texture>()
  for (const material of materials) {
    for (const value of Object.values(material)) if (isTexture(value)) textures.add(value)
    const uniforms = (material as THREE.ShaderMaterial).uniforms
    if (uniforms) for (const uniform of Object.values(uniforms)) if (isTexture(uniform?.value)) textures.add(uniform.value)
  }
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) texture.dispose()
}

function isTexture(value: unknown): value is THREE.Texture {
  return (value as THREE.Texture | null)?.isTexture === true
}
