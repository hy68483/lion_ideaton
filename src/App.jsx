import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import Controls from './components/Controls.jsx'
import GazeTracker from './components/GazeTracker.jsx'
import PdfViewer from './components/PdfViewer.jsx'
import ReadingStatusPanel from './components/ReadingStatusPanel.jsx'
import { useDwellHighlight } from './hooks/useDwellHighlight.js'
import { useTextLayerRects } from './hooks/useTextLayerRects.js'
import { useWebGazer } from './hooks/useWebGazer.js'

const DEFAULT_DWELL_TIME = 800
const DEFAULT_TOLERANCE = 10

function App() {
  const viewerRef = useRef(null)
  const [pdfFile, setPdfFile] = useState(null)
  const [numPages, setNumPages] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1.1)
  const [textLayerVersion, setTextLayerVersion] = useState(0)

  const { gazePoint, isTracking, status, error, start, stop } = useWebGazer()
  const { rects, recalculate, lastMeasuredAt } = useTextLayerRects(
    viewerRef,
    `${pageNumber}-${scale}-${textLayerVersion}`,
  )

  const {
    currentTarget,
    currentTargetId,
    highlightedIds,
    highlightedTexts,
    clearHighlights,
  } = useDwellHighlight({
    gazePoint,
    textRects: rects,
    dwellTime: DEFAULT_DWELL_TIME,
    tolerance: DEFAULT_TOLERANCE,
  })

  const highlightedPreview = useMemo(
    () => highlightedTexts.slice(-5).map((item) => item.text),
    [highlightedTexts],
  )

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setPdfFile(file)
    setPageNumber(1)
    setNumPages(null)
    clearHighlights()
    window.setTimeout(recalculate, 500)
  }

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // React-PDF text layer span에 상태 class를 반영해 하이라이트를 직접 표시한다.
    viewer.querySelectorAll('[data-gaze-text-id]').forEach((span) => {
      const id = span.dataset.gazeTextId
      span.classList.toggle('gaze-current-text', id === currentTargetId)
      span.classList.toggle('gaze-highlighted-text', highlightedIds.has(id))
    })
  }, [currentTargetId, highlightedIds, rects])

  return (
    <main className="app-shell">
      <PdfViewer
        ref={viewerRef}
        file={pdfFile}
        pageNumber={pageNumber}
        numPages={numPages}
        scale={scale}
        onLoadSuccess={({ numPages: loadedPages }) => {
          setNumPages(loadedPages)
          setTextLayerVersion((version) => version + 1)
        }}
        onRenderSuccess={() => {
          setTextLayerVersion((version) => version + 1)
          window.setTimeout(recalculate, 150)
        }}
        onPageChange={(nextPage) => {
          setPageNumber(nextPage)
          window.setTimeout(recalculate, 250)
        }}
        onScaleChange={(nextScale) => {
          setScale(Number(nextScale.toFixed(2)))
          window.setTimeout(recalculate, 250)
        }}
      />

      <aside className="side-rail">
        <ReadingStatusPanel
          gazePoint={gazePoint}
          currentTarget={currentTarget}
          highlightedCount={highlightedIds.size}
          rectCount={rects.length}
          status={status}
          error={error}
          lastMeasuredAt={lastMeasuredAt}
        />

        <Controls
          isTracking={isTracking}
          onStart={start}
          onStop={stop}
          onRecalculate={recalculate}
          onFileChange={handleFileChange}
          onClearHighlights={clearHighlights}
        />

        <section className="panel preview-panel" aria-label="최근 하이라이트">
          <h2>최근 하이라이트</h2>
          {highlightedPreview.length > 0 ? (
            <ul>
              {highlightedPreview.map((text, index) => (
                <li key={`${text}-${index}`}>{text}</li>
              ))}
            </ul>
          ) : (
            <p className="subtle-text">아직 하이라이트된 텍스트가 없습니다.</p>
          )}
        </section>
      </aside>

      <GazeTracker gazePoint={gazePoint} isTracking={isTracking} />
    </main>
  )
}

export default App
