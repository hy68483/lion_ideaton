export function isPointInsideRect(point, rect, tolerance = 0) {
  if (!point || !rect) return false

  return (
    point.x >= rect.left - tolerance &&
    point.x <= rect.right + tolerance &&
    point.y >= rect.top - tolerance &&
    point.y <= rect.bottom + tolerance
  )
}

export function normalizeGazePoint(data) {
  if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) {
    return null
  }

  return {
    x: Math.round(data.x),
    y: Math.round(data.y),
    timestamp: Date.now(),
  }
}
