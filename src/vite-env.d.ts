/// <reference types="vite/client" />

// .md decks are compiled to slide objects by vite-plugin-slides
declare module '*.md' {
  const slides: import('./engine/slide-types').CompiledSlide[]
  export default slides
}
