import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import CalibrationOverlay from './components/CalibrationOverlay.jsx'
import GazeHighlightOverlay from './components/GazeHighlightOverlay.jsx'
import Controls from './components/Controls.jsx'
import GazeTracker from './components/GazeTracker.jsx'
import PdfViewer from './components/PdfViewer.jsx'
import ReadingStatusPanel from './components/ReadingStatusPanel.jsx'
import { useDwellHighlight } from './hooks/useDwellHighlight.js'
import { useTextLayerRects } from './hooks/useTextLayerRects.js'
import { useWebGazer } from './hooks/useWebGazer.js'

const DEFAULT_DWELL_TIME = 700
const DEFAULT_TOLERANCE = 85
const DEFAULT_TARGET_HOLD_TIME = 80
const READING_MODE_SCALE = 1.45

function App() {
  const viewerRef = useRef(null)
  const [pdfFile, setPdfFile] = useState(null)
  const [numPages, setNumPages] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1.1)
  const [isCalibrating, setIsCalibrating] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [focusEffect, setFocusEffect] = useState('mosaic')

  const {
    gazePoint,
    isTracking,
    status,
    error,
    trackerInfo,
    recordCalibrationPoint,
    resetCalibration,
    start,
    stop,
  } = useWebGazer()
  const { rects, recalculate, lastMeasuredAt } = useTextLayerRects(
    viewerRef,
    `${pageNumber}-${scale}-${Boolean(pdfFile)}`,
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
    holdTime: DEFAULT_TARGET_HOLD_TIME,
    disabled: isCalibrating,
  })

  const highlightedPreview = useMemo(
    () => highlightedTexts.slice(-5).map((item) => item.text),
    [highlightedTexts],
  )
  const canUseFocusMode = Boolean(pdfFile && isTracking && !isCalibrating)
  const isReadingMode = Boolean(canUseFocusMode && isFocusMode)

  const handleFileChange = useCallback((event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setPdfFile(file)
    setPageNumber(1)
    setNumPages(null)
    clearHighlights()
    if (isTracking && !isCalibrating) {
      setIsFocusMode(true)
      setScale((currentScale) => Math.max(currentScale, READING_MODE_SCALE))
    }
    window.setTimeout(recalculate, 500)
  }, [clearHighlights, isCalibrating, isTracking, recalculate])

  const handlePdfLoadSuccess = useCallback(
    ({ numPages: loadedPages }) => {
      setNumPages(loadedPages)
      window.setTimeout(recalculate, 150)
    },
    [recalculate],
  )

  const handlePdfRenderSuccess = useCallback(() => {
    window.setTimeout(recalculate, 150)
  }, [recalculate])

  const handlePageChange = useCallback(
    (nextPage) => {
      setPageNumber(nextPage)
      window.setTimeout(recalculate, 250)
    },
    [recalculate],
  )

  const handleScaleChange = useCallback(
    (nextScale) => {
      setScale(Number(nextScale.toFixed(2)))
      window.setTimeout(recalculate, 250)
    },
    [recalculate],
  )

  const handleStartTracking = async () => {
    const started = await start()
    if (started) {
      resetCalibration()
      setIsCalibrating(true)
    }
  }

  const handleStopTracking = () => {
    setIsCalibrating(false)
    setIsFocusMode(false)
    stop()
  }

  const handleFinishCalibration = useCallback(() => {
    setIsCalibrating(false)

    if (pdfFile) {
      setIsFocusMode(true)
      setScale((currentScale) => Math.max(currentScale, READING_MODE_SCALE))
      window.setTimeout(recalculate, 250)
    }
  }, [pdfFile, recalculate])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // React-PDF text layer span에 상태 class를 반영해 하이라이트를 직접 표시한다.
    viewer.querySelectorAll('[data-gaze-text-id]').forEach((span) => {
      const lineId = span.dataset.gazeLineId
      const isCurrent = !isCalibrating && lineId === currentTargetId
      const isHighlighted = !isCalibrating && highlightedIds.has(lineId)

      span.classList.toggle('gaze-current-text', isCurrent)
      span.classList.toggle('gaze-highlighted-text', isHighlighted)
    })
  }, [currentTargetId, highlightedIds, isCalibrating, rects])

  return (
    <main className={`app-shell${isReadingMode ? ' app-shell-reading' : ''}`}>
      <PdfViewer
        ref={viewerRef}
        file={pdfFile}
        pageNumber={pageNumber}
        numPages={numPages}
        scale={scale}
        onLoadSuccess={handlePdfLoadSuccess}
        onRenderSuccess={handlePdfRenderSuccess}
        onPageChange={handlePageChange}
        onScaleChange={handleScaleChange}
      />

      <aside className="side-rail">
        <ReadingStatusPanel
          gazePoint={gazePoint}
          currentTarget={currentTarget}
          highlightedCount={highlightedIds.size}
          rectCount={rects.length}
          hasPdf={Boolean(pdfFile)}
          status={status}
          error={error}
          lastMeasuredAt={lastMeasuredAt}
          trackerInfo={trackerInfo}
        />

        <Controls
          isTracking={isTracking}
          onStart={handleStartTracking}
          onStop={handleStopTracking}
          onRecalculate={recalculate}
          onCalibrate={() => {
            resetCalibration()
            setIsFocusMode(false)
            setIsCalibrating(true)
          }}
          onFileChange={handleFileChange}
          onClearHighlights={clearHighlights}
          focusEffect={focusEffect}
          onFocusEffectChange={setFocusEffect}
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

      {canUseFocusMode && (
        <button
          type="button"
          className="study-mode-button"
          onClick={() => setIsFocusMode((current) => !current)}
        >
          {isReadingMode ? '패널 보기' : '공부 모드'}
        </button>
      )}

      <GazeTracker gazePoint={gazePoint} isTracking={isTracking} />
      <GazeHighlightOverlay
        currentTarget={isCalibrating ? null : currentTarget}
        highlightedTexts={isCalibrating ? [] : highlightedTexts}
        focusEffect={focusEffect}
      />
      <CalibrationOverlay
        visible={isCalibrating}
        onRecord={recordCalibrationPoint}
        onComplete={handleFinishCalibration}
        onSkip={handleFinishCalibration}
      />
    </main>
  )
}

export default App
