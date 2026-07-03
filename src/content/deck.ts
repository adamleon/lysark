import { defineDeck } from '../engine/deck'
import arm from '../scenes/arm'
import pendulum from '../scenes/pendulum'
import slides from './slides.md'

export default defineDeck({
  scenes: { arm, pendulum },
  slides,
})
