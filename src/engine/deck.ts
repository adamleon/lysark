import type { CompiledSlide } from './slide-types'
import type { SceneModule } from './scene-types'

export interface Deck {
  scenes: Record<string, SceneModule>
  slides: CompiledSlide[]
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
  return deck
}
