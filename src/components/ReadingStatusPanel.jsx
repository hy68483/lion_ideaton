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
  trackerInfo,
}) {
  const currentText =
    currentTarget?.text ||
    (hasPdf && rectCount === 0
      ? '텍스트 레이어가 없습니다. 스캔 이미지 PDF이면 텍스트를 추출할 수 없습니다.'
      : '-')
  const confidenceText =
    typeof currentTarget?.confidence === 'number'
      ? `${Math.round(currentTarget.confidence * 100)}% / ${currentTarget.matchDistance}px`
      : '-'
  const gazeConfidenceText =
    typeof gazePoint?.confidence === 'number'
      ? `${Math.round(gazePoint.confidence * 100)}%`
      : '-'
  const calibrationErrorText = trackerInfo?.calibrationErrorPx
    ? ` · 검증 ${trackerInfo.calibrationErrorPx.median}/${trackerInfo.calibrationErrorPx.p90}px`
    : ''
  const hybridStateText =
    trackerInfo?.isHybridCalibrated && !trackerInfo?.isHybridReliable
      ? ' · hybrid 보류'
      : ''
  const trackerText = trackerInfo
    ? `${trackerInfo.engine} · 보정 ${trackerInfo.calibrationSamples}개${calibrationErrorText}${hybridStateText}`
    : '-'

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
            <strong>
              {gazePoint
                ? `${gazePoint.x}, ${gazePoint.y} (${gazePoint.source})`
                : '-'}
            </strong>
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

        <div className="status-item">
          <Activity size={17} />
          <div>
            <span>매칭 신뢰도 / 거리</span>
            <strong>{confidenceText}</strong>
          </div>
        </div>

        <div className="status-item">
          <Eye size={17} />
          <div>
            <span>추적 엔진 / Gaze 신뢰도</span>
            <strong>
              {trackerText} / {gazeConfidenceText}
            </strong>
          </div>
        </div>
      </div>

      <div className={`tracker-state tracker-state-${status}`}>
        Tracker: {status}
        {trackerInfo?.mediaPipeReady ? ' · MediaPipe ready' : ''}
        {trackerInfo?.onnxReady ? ' · ONNX ready' : ''}
        {trackerInfo?.faceDetected ? ' · face detected' : ''}
      </div>

      <p className="helper-text">
        시작 버튼을 누르면 브라우저가 웹캠 권한을 요청합니다. 현재는 ONNX 없이
        WebGazer와 MediaPipe만 사용합니다.
      </p>

      {lastMeasuredAt && (
        <p className="subtle-text">좌표 계산: {lastMeasuredAt.toLocaleTimeString()}</p>
      )}

      {error && <p className="error-text">{error}</p>}
    </section>
  )
}
