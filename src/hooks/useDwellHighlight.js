import { useEffect, useMemo, useRef, useState } from 'react'
import { isPointInsideRect } from '../utils/coordinate.js'

export function useDwellHighlight({
  gazePoint,
  textRects,
  dwellTime = 800,
  tolerance = 8,
}) {
  const dwellStartRef = useRef(null)
  const previousTargetIdRef = useRef(null)
  const [highlightedIds, setHighlightedIds] = useState(() => new Set())

  const currentTarget = useMemo(
    () => {
      if (!gazePoint || textRects.length === 0) return null

      return (
        textRects.find((rect) => isPointInsideRect(gazePoint, rect, tolerance)) ||
        null
      )
    },
    [gazePoint, textRects, tolerance],
  )

  const currentTargetId = currentTarget?.id || null
  const gazeTimestamp = gazePoint?.timestamp ?? 0

  useEffect(() => {
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
  }, [dwellTime, currentTargetId, gazeTimestamp])

  const highlightedTexts = useMemo(
    () => textRects.filter((rect) => highlightedIds.has(rect.id)),
    [highlightedIds, textRects],
  )

  const clearHighlights = () => {
    setHighlightedIds(new Set())
  }

  return {
    currentTarget,
    currentTargetId,
    highlightedIds,
    highlightedTexts,
    clearHighlights,
  }
}
