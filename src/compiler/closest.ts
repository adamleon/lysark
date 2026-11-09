/** the known word closest to `word`, if it is close enough to be a typo of it */
export function closest(word: string, known: readonly string[]): string | undefined {
  // edits to turn a into b, two letters swapped counting as one (optimal string alignment)
  const distance = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
    return d[a.length][b.length]
  }
  let best: string | undefined
  let bestDistance = Infinity
  for (const k of known) {
    const d = distance(word.toLowerCase(), k.toLowerCase())
    if (d < bestDistance) [best, bestDistance] = [k, d]
  }
  // close enough to be a typo, and not a guess at a word of one letter
  return bestDistance <= Math.max(1, Math.floor(word.length / 3)) && bestDistance < word.length ? best : undefined
}
