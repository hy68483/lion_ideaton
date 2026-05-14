import {
  Crosshair,
  FileUp,
  Highlighter,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react'

export default function Controls({
  isTracking,
  onStart,
  onStop,
  onRecalculate,
  onFileChange,
  onClearHighlights,
}) {
  return (
    <section className="panel controls-panel" aria-label="PDF reader controls">
      <div className="panel-heading">
        <Crosshair size={18} />
        <h2>컨트롤</h2>
      </div>

      <div className="control-stack">
        <button
          type="button"
          className="primary-button"
          onClick={isTracking ? onStop : onStart}
        >
          {isTracking ? <Pause size={18} /> : <Play size={18} />}
          {isTracking ? 'WebGazer 중지' : 'WebGazer 시작'}
        </button>

        <button type="button" onClick={onRecalculate}>
          <RefreshCw size={18} />
          Text Layer 좌표 재계산
        </button>

        <button type="button" onClick={onClearHighlights}>
          <Highlighter size={18} />
          하이라이트 초기화
        </button>

        <label className="file-control">
          <FileUp size={18} />
          PDF 업로드
          <input type="file" accept="application/pdf" onChange={onFileChange} />
        </label>
      </div>
    </section>
  )
}
