import { defineDeck } from '../../engine/deck'
import arm from '../../scenes/arm'
import pendulum from '../../scenes/pendulum'
import agilus from '../../scenes/agilus'
import slides from './slides.md'

export default defineDeck({
  scenes: { arm, pendulum, agilus },
  slides,
})
