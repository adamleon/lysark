import type { ModelLoader, SceneObject } from './object-types'
import type { CompiledSlide } from './slide-types'
import type { SceneModule } from './scene-types'

export interface Deck {
  scenes: Record<string, SceneModule>
  slides: CompiledSlide[]
  /** the lecture's objects, by the scene they are in (docs/scene-files.md) */
  objects?: Record<string, SceneObject[]>
  /**
   * builds the objects' models (src/scene/models.ts). Only a deck with a model
   * in a scene it runs has one, so three.js's loaders stay out of every other
   * lecture file (vite-plugin-lecture.ts)
   */
  models?: ModelLoader
}

/** deck manifest (spec §7): static imports only — no dynamic import() (§9b) */
export function defineDeck(deck: Deck): Deck {
  for (const [key, module] of Object.entries(deck.scenes)) {
    if (module.id !== key) {
      throw new Error(`deck: scene registered as '${key}' but its module id is '${module.id}'`)
    }
  }
  for (const slide of deck.slides) {
    if (slide.scene && !deck.scenes[slide.scene]) {
      throw new Error(`deck: slide '${slide.id}' references unknown scene '${slide.scene}'`)
    }
  }
  for (const [scene, objects] of Object.entries(deck.objects ?? {})) {
    if (!deck.scenes[scene]) throw new Error(`deck: objects for unknown scene '${scene}'`)
    // without a loader its models would be left out without a word
    const model = deck.models ? undefined : objects.find((object) => object.shape === 'model')
    if (model) throw new Error(`deck: object '${model.name}' has a model, but the deck has no model loader`)
  }
  return deck
}
