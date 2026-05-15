import { Activity, Eye, Layers, MousePointer2 } from 'lucide-react'

export default function ReadingStatusPanel({
  gazePoint,
  currentTarget,
  highlightedCount,
  rectCount,
  hasPdf,
  status,
  error,
  lastMeasuredAt,
}) {
  const currentText =
    currentTarget?.text ||
    (hasPdf && rectCount === 0
      ? '텍스트 레이어가 없습니다. 스캔 이미지 PDF이면 텍스트를 추출할 수 없습니다.'
      : '-')

  return (
    <section className="panel status-panel" aria-label="Reading status">
      <div className="panel-heading">
        <Activity size={18} />
        <h2>상태</h2>
      </div>

      <div className="status-grid">
        <div className="status-item">
          <MousePointer2 size={17} />
          <div>
            <span>Gaze 좌표</span>
            <strong>{gazePoint ? `${gazePoint.x}, ${gazePoint.y}` : '-'}</strong>
          </div>
        </div>

        <div className="status-item">
          <Eye size={17} />
          <div>
            <span>현재 바라보는 텍스트</span>
            <strong className="current-text">{currentText}</strong>
          </div>
        </div>

        <div className="status-item">
          <Layers size={17} />
          <div>
            <span>Text Layer / 하이라이트</span>
            <strong>
              {rectCount}개 / {highlightedCount}개
            </strong>
          </div>
        </div>
      </div>

      <div className={`tracker-state tracker-state-${status}`}>
        WebGazer: {status}
      </div>

      <p className="helper-text">
        시작 버튼을 누르면 브라우저가 웹캠 권한을 요청합니다. 정확도를 높이려면
        화면을 보며 몇 초간 시선을 안정적으로 유지해 주세요.
      </p>

      {lastMeasuredAt && (
        <p className="subtle-text">좌표 계산: {lastMeasuredAt.toLocaleTimeString()}</p>
      )}

      {error && <p className="error-text">{error}</p>}
    </section>
  )
}
