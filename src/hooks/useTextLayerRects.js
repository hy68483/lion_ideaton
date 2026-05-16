import { useCallback, useEffect, useRef, useState } from 'react'

const TEXT_LAYER_SELECTOR =
  '.react-pdf__Page__textContent span, .textLayer span, [data-gaze-text-id]'
const LINE_VERTICAL_TOLERANCE_RATIO = 0.7
const COLUMN_GAP_THRESHOLD = 96
const TARGET_HORIZONTAL_PADDING = 10
const TARGET_VERTICAL_PADDING = 5

function getCenterY(rect) {
  return rect.top + rect.height / 2
}

function mergeSpanIntoLine(line, spanRect) {
  const nextCount = line.spans.length + 1
  const spanCenterY = getCenterY(spanRect)

  line.spans.push(spanRect)
  line.left = Math.min(line.left, spanRect.left)
  line.top = Math.min(line.top, spanRect.top)
  line.right = Math.max(line.right, spanRect.right)
  line.bottom = Math.max(line.bottom, spanRect.bottom)
  line.height = Math.max(line.height, spanRect.height)
  line.centerY = (line.centerY * (nextCount - 1) + spanCenterY) / nextCount
}

function splitWideLine(line) {
  const sortedSpans = [...line.spans].sort((a, b) => a.left - b.left)
  const groups = []

  sortedSpans.forEach((spanRect) => {
    const currentGroup = groups.at(-1)
    const gap = currentGroup ? spanRect.left - currentGroup.right : 0
    const gapThreshold = Math.max(COLUMN_GAP_THRESHOLD, line.height * 8)

    if (!currentGroup || gap > gapThreshold) {
      groups.push({
        pageNumber: line.pageNumber,
        spans: [spanRect],
        left: spanRect.left,
        top: spanRect.top,
        right: spanRect.right,
        bottom: spanRect.bottom,
      })
      return
    }

    currentGroup.spans.push(spanRect)
    currentGroup.left = Math.min(currentGroup.left, spanRect.left)
    currentGroup.top = Math.min(currentGroup.top, spanRect.top)
    currentGroup.right = Math.max(currentGroup.right, spanRect.right)
    currentGroup.bottom = Math.max(currentGroup.bottom, spanRect.bottom)
  })

  return groups
}

function buildLineTargets(spanRects) {
  const lines = []

  spanRects
    .sort((a, b) => a.pageNumber - b.pageNumber || a.top - b.top || a.left - b.left)
    .forEach((spanRect) => {
      const centerY = getCenterY(spanRect)
      const existingLine = lines.find((line) => {
        if (line.pageNumber !== spanRect.pageNumber) return false

        const tolerance =
          Math.max(line.height, spanRect.height) * LINE_VERTICAL_TOLERANCE_RATIO

        return Math.abs(line.centerY - centerY) <= tolerance
      })

      if (existingLine) {
        mergeSpanIntoLine(existingLine, spanRect)
        return
      }

      lines.push({
        pageNumber: spanRect.pageNumber,
        spans: [spanRect],
        left: spanRect.left,
        top: spanRect.top,
        right: spanRect.right,
        bottom: spanRect.bottom,
        height: spanRect.height,
        centerY,
      })
    })

  return lines
    .flatMap(splitWideLine)
    .sort((a, b) => a.pageNumber - b.pageNumber || a.top - b.top || a.left - b.left)
    .map((line, index) => {
      const id = `page-${line.pageNumber || 'unknown'}-line-${index}`
      const left = Math.max(0, line.left - TARGET_HORIZONTAL_PADDING)
      const top = Math.max(0, line.top - TARGET_VERTICAL_PADDING)
      const right = line.right + TARGET_HORIZONTAL_PADDING
      const bottom = line.bottom + TARGET_VERTICAL_PADDING
      const sortedSpans = [...line.spans].sort((a, b) => a.left - b.left)

      sortedSpans.forEach((spanRect) => {
        spanRect.element.dataset.gazeLineId = id
      })

      return {
        id,
        spanIds: sortedSpans.map((spanRect) => spanRect.id),
        text: sortedSpans
          .map((spanRect) => spanRect.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
        pageNumber: line.pageNumber,
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        elements: sortedSpans.map((spanRect) => spanRect.element),
      }
    })
    .filter((line) => line.text && line.width > 0 && line.height > 0)
}

export function useTextLayerRects(viewerRef, dependencyKey = '') {
  const retryRef = useRef(null)
  const [rects, setRects] = useState([])
  const [lastMeasuredAt, setLastMeasuredAt] = useState(null)

  const collectRects = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return []

    const spans = Array.from(viewer.querySelectorAll(TEXT_LAYER_SELECTOR))

    const spanRects = spans
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

    return buildLineTargets(spanRects)
  }, [viewerRef])

  const recalculate = useCallback(() => {
    window.clearTimeout(retryRef.current)

    const nextRects = collectRects()

    // PDF text layer가 비동기로 늦게 붙는 경우 짧게 재시도한다.
    if (nextRects.length === 0) {
      setRects([])
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
