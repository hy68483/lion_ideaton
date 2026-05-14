import { useCallback, useEffect, useRef, useState } from 'react'

const TEXT_LAYER_SELECTOR = '.react-pdf__Page__textContent span'

export function useTextLayerRects(viewerRef, dependencyKey = '') {
  const retryRef = useRef(null)
  const [rects, setRects] = useState([])
  const [lastMeasuredAt, setLastMeasuredAt] = useState(null)

  const collectRects = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return []

    const spans = Array.from(viewer.querySelectorAll(TEXT_LAYER_SELECTOR))

    return spans
      .map((span, index) => {
        const pageElement = span.closest('.react-pdf__Page')
        const pageNumber = Number(pageElement?.dataset?.pageNumber || 0)
        const box = span.getBoundingClientRect()
        const text = span.textContent?.trim() || ''
        const id = `page-${pageNumber || 'unknown'}-text-${index}`

        span.dataset.gazeTextId = id

        return {
          id,
          text,
          pageNumber,
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
          element: span,
        }
      })
      .filter((rect) => rect.text && rect.width > 0 && rect.height > 0)
  }, [viewerRef])

  const recalculate = useCallback(() => {
    window.clearTimeout(retryRef.current)

    const nextRects = collectRects()

    // PDF text layer가 비동기로 늦게 붙는 경우 짧게 재시도한다.
    if (nextRects.length === 0) {
      retryRef.current = window.setTimeout(() => {
        const retryRects = collectRects()
        setRects(retryRects)
        setLastMeasuredAt(new Date())
      }, 350)
      return
    }

    setRects(nextRects)
    setLastMeasuredAt(new Date())
  }, [collectRects])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      recalculate()
    })

    const handleViewportChange = () => recalculate()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(retryRef.current)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [recalculate, dependencyKey])

  return {
    rects,
    recalculate,
    lastMeasuredAt,
  }
}
