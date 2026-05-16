import { useEffect, useMemo, useRef, useState } from 'react'

const POINTS = [
  { x: 12, y: 12 },
  { x: 50, y: 10 },
  { x: 88, y: 12 },
  { x: 18, y: 32 },
  { x: 50, y: 32 },
  { x: 82, y: 32 },
  { x: 8, y: 50 },
  { x: 50, y: 50 },
  { x: 92, y: 50 },
  { x: 18, y: 68 },
  { x: 50, y: 68 },
  { x: 82, y: 68 },
  { x: 12, y: 88 },
  { x: 50, y: 90 },
  { x: 88, y: 88 },
]

const CLICKS_PER_POINT = 3

export default function CalibrationOverlay({ visible, onRecord, onComplete, onSkip }) {
  const [pointIndex, setPointIndex] = useState(0)
  const [clickCount, setClickCount] = useState(0)
  const [feedback, setFeedback] = useState('')
  const pointShownAtRef = useRef(0)

  const progress = useMemo(
    () => pointIndex * CLICKS_PER_POINT + clickCount,
    [pointIndex, clickCount],
  )
  const total = POINTS.length * CLICKS_PER_POINT
  const currentPoint = POINTS[pointIndex]

  useEffect(() => {
    if (!visible) return

    pointShownAtRef.current = Date.now()
  }, [visible, pointIndex])

  if (!visible || !currentPoint) return null

  const resetProgress = () => {
    setPointIndex(0)
    setClickCount(0)
    setFeedback('')
  }

  const handlePointClick = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2

    const recorded = onRecord(x, y, {
      pointShownAt: pointShownAtRef.current,
    })
    if (recorded === false) {
      setFeedback('점이 표시된 뒤 시선이 아직 안정되지 않았습니다. 점을 계속 보고 다시 클릭하세요.')
      return
    }

    setFeedback('')
    const nextClickCount = clickCount + 1
    if (nextClickCount < CLICKS_PER_POINT) {
      setClickCount(nextClickCount)
      return
    }

    if (pointIndex < POINTS.length - 1) {
      setPointIndex(pointIndex + 1)
      setClickCount(0)
      return
    }

    resetProgress()
    onComplete()
  }

  const handleSkip = () => {
    resetProgress()
    onSkip()
  }

  return (
    <div className="calibration-overlay">
      <div className="calibration-instructions">
        <strong>시선 보정</strong>
        <span>
          파란 점을 정확히 바라본 상태로 클릭하세요. 각 위치마다 {CLICKS_PER_POINT}번씩
          클릭하면 WebGazer와 얼굴 랜드마크를 함께 보정합니다.
        </span>
        <small>
          {progress} / {total}
        </small>
        {feedback && <small className="calibration-feedback">{feedback}</small>}
        <button type="button" onClick={handleSkip}>
          건너뛰기
        </button>
      </div>

      <button
        type="button"
        className="calibration-point"
        style={{
          left: `${currentPoint.x}%`,
          top: `${currentPoint.y}%`,
        }}
        onClick={handlePointClick}
        aria-label="시선 보정 지점"
      >
        <span>{clickCount + 1}</span>
      </button>
    </div>
  )
}
