import type * as THREE from 'three'

/**
 * Frees every GPU resource under a scene root: geometries, materials, and
 * shadow maps. The CPU-side graph survives — typed arrays and image sources
 * stay usable, and three.js re-uploads lazily on the next render. Used both
 * for suspend (GPU-only, spec §4.1 v1 shortcut) and inside full teardown.
 */
export function disposeSceneGraph(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh || (obj as THREE.LineSegments).isLineSegments) {
      mesh.geometry?.dispose()
      const material = mesh.material
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material?.dispose()
    }
    const light = obj as THREE.DirectionalLight
    if (light.isLight && light.shadow) {
      light.shadow.dispose()
      // three only reallocates the shadow render target when map is null
      light.shadow.map = null
    }
  })
}
