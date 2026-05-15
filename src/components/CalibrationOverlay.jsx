import { useMemo, useState } from 'react'

const POINTS = [
  { x: 18, y: 18 },
  { x: 50, y: 18 },
  { x: 82, y: 18 },
  { x: 18, y: 50 },
  { x: 50, y: 50 },
  { x: 82, y: 50 },
  { x: 18, y: 82 },
  { x: 50, y: 82 },
  { x: 82, y: 82 },
]

const CLICKS_PER_POINT = 3

export default function CalibrationOverlay({ visible, onRecord, onComplete, onSkip }) {
  const [pointIndex, setPointIndex] = useState(0)
  const [clickCount, setClickCount] = useState(0)

  const progress = useMemo(
    () => pointIndex * CLICKS_PER_POINT + clickCount,
    [pointIndex, clickCount],
  )
  const total = POINTS.length * CLICKS_PER_POINT
  const currentPoint = POINTS[pointIndex]

  if (!visible || !currentPoint) return null

  const handlePointClick = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2

    onRecord(x, y)

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

    setPointIndex(0)
    setClickCount(0)
    onComplete()
  }

  return (
    <div className="calibration-overlay">
      <div className="calibration-instructions">
        <strong>시선 보정</strong>
        <span>
          파란 점을 바라본 상태로 클릭하세요. 각 위치마다 {CLICKS_PER_POINT}번씩
          클릭하면 실제 gaze 좌표가 안정적으로 계산됩니다.
        </span>
        <small>
          {progress} / {total}
        </small>
        <button type="button" onClick={onSkip}>
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
