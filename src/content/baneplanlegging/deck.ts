import { defineDeck } from '../../engine/deck'
import agilus from '../../scenes/agilus'
import agilusDuo from '../../scenes/agilus-duo'
import slides from './slides.md'

// AIS2105 — Baneplanlegging. Core interactive slice on the real KUKA agilus;
// the comparison slide overlays two of them (agilus-duo).
export default defineDeck({
  scenes: { agilus, 'agilus-duo': agilusDuo },
  slides,
})
