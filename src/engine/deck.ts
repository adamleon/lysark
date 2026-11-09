import type { SceneObject } from './object-types'
import type { CompiledSlide } from './slide-types'
import type { SceneModule } from './scene-types'

export interface Deck {
  scenes: Record<string, SceneModule>
  slides: CompiledSlide[]
  /** the lecture's objects, by the scene they are in (docs/scene-files.md) */
  objects?: Record<string, SceneObject[]>
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
  for (const scene of Object.keys(deck.objects ?? {})) {
    if (!deck.scenes[scene]) throw new Error(`deck: objects for unknown scene '${scene}'`)
  }
  return deck
}
