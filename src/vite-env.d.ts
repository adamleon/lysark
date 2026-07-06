/// <reference types="vite/client" />

// .md decks are compiled to slide objects by vite-plugin-slides
declare module '*.md' {
  const slides: import('./engine/slide-types').CompiledSlide[]
  export default slides
}

// The active deck, resolved by the `@active-deck` alias in vite.config.ts from
// LYSARK_DECK (default 'demo') to src/content/<deck>/deck.ts. One static import,
// so only the selected deck's code + assets bundle — file://-safe (spec §9b).
declare module '@active-deck' {
  const deck: import('./engine/deck').Deck
  export default deck
}
