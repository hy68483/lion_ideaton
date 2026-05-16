import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function distanceToRect(point, rect) {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right)
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom)

  return Math.hypot(dx, dy)
}

function findBestTarget(point, textRects, snapRadius) {
  if (!point || textRects.length === 0) return null

  const bestCandidate = textRects.reduce((best, rect) => {
    const distance = distanceToRect(point, rect)

    if (distance > snapRadius) return best
    if (!best || distance < best.distance) {
      return { rect, distance }
    }

    return best
  }, null)

  if (!bestCandidate) return null

  const confidence = Math.max(
    0,
    Math.min(1, 1 - bestCandidate.distance / snapRadius),
  )

  return {
    ...bestCandidate.rect,
    matchDistance: Math.round(bestCandidate.distance),
    confidence,
  }
}

export function useDwellHighlight({
  gazePoint,
  textRects,
  dwellTime = 800,
  tolerance = 8,
  holdTime = 350,
  disabled = false,
}) {
  const dwellStartRef = useRef(null)
  const previousTargetIdRef = useRef(null)
  const lastMatchedAtRef = useRef(0)
  const lastTargetRef = useRef(null)
  const [highlightedIds, setHighlightedIds] = useState(() => new Set())
  const [currentTarget, setCurrentTarget] = useState(null)

  const gazeTimestamp = gazePoint?.timestamp ?? 0

  useEffect(() => {
    if (disabled) {
      dwellStartRef.current = null
      previousTargetIdRef.current = null
      lastTargetRef.current = null
      const frameId = window.requestAnimationFrame(() => setCurrentTarget(null))

      return () => {
        window.cancelAnimationFrame(frameId)
      }
    }

    const frameId = window.requestAnimationFrame(() => {
      if (textRects.length === 0) {
        lastTargetRef.current = null
        setCurrentTarget(null)
        return
      }

      const matchedTarget = findBestTarget(gazePoint, textRects, tolerance)
      const now = Date.now()

      if (matchedTarget) {
        lastMatchedAtRef.current = now
        lastTargetRef.current = matchedTarget
        setCurrentTarget(matchedTarget)
        return
      }

      if (lastTargetRef.current && now - lastMatchedAtRef.current <= holdTime) {
        setCurrentTarget(lastTargetRef.current)
        return
      }

      lastTargetRef.current = null
      setCurrentTarget(null)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [disabled, gazePoint, gazeTimestamp, holdTime, textRects, tolerance])

  const currentTargetId = currentTarget?.id || null

  useEffect(() => {
    if (disabled) {
      dwellStartRef.current = null
      previousTargetIdRef.current = null
      return
    }

    if (!currentTargetId) {
      dwellStartRef.current = null
      previousTargetIdRef.current = null
      return
    }

    if (previousTargetIdRef.current !== currentTargetId) {
      previousTargetIdRef.current = currentTargetId
      dwellStartRef.current = Date.now()
      return
    }

    const startedAt = dwellStartRef.current ?? Date.now()
    dwellStartRef.current = startedAt

    // 같은 텍스트에 dwellTime 이상 머물면 하이라이트를 영구 유지한다.
    if (Date.now() - startedAt >= dwellTime) {
      window.setTimeout(() => {
        setHighlightedIds((previous) => {
          if (previous.has(currentTargetId)) return previous
          const next = new Set(previous)
          next.add(currentTargetId)
          return next
        })
      }, 0)
    }
  }, [disabled, dwellTime, currentTargetId, gazeTimestamp])

  const highlightedTexts = useMemo(
    () => textRects.filter((rect) => highlightedIds.has(rect.id)),
    [highlightedIds, textRects],
  )

  const clearHighlights = useCallback(() => {
    setHighlightedIds(new Set())
  }, [])

  return {
    currentTarget,
    currentTargetId,
    highlightedIds,
    highlightedTexts,
    clearHighlights,
  }
}
