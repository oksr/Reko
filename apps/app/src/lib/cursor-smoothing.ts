/**
 * Smooths cursor positions using a weighted moving average to avoid jittery zoom.
 * Samples points in a trailing window and applies exponential decay favoring recent positions.
 */
export function getSmoothedCursorAt(
  getCursorAt: (timeMs: number) => { x: number; y: number } | null,
  timeMs: number,
  windowMs = 150
): { x: number; y: number } | null {
  const samples = 7
  let totalWeight = 0
  let wx = 0
  let wy = 0
  let hitCount = 0

  for (let i = 0; i < samples; i++) {
    const t = timeMs - windowMs + (windowMs * i) / (samples - 1)
    const pos = getCursorAt(t)
    if (!pos) continue

    // Exponential decay: more recent samples get higher weight
    const weight = Math.exp((i - (samples - 1)) / 2)
    wx += pos.x * weight
    wy += pos.y * weight
    totalWeight += weight
    hitCount++
  }

  if (hitCount === 0) return null

  return { x: wx / totalWeight, y: wy / totalWeight }
}
