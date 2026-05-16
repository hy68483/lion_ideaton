import {
  Crosshair,
  FileUp,
  Highlighter,
  Pause,
  Play,
  RefreshCw,
  Target,
} from 'lucide-react'

const FOCUS_EFFECT_OPTIONS = [
  { value: 'mosaic', label: '모자이크' },
  { value: 'blur', label: '블러' },
  { value: 'highlight', label: '표시만' },
]

export default function Controls({
  isTracking,
  onStart,
  onStop,
  onRecalculate,
  onCalibrate,
  onFileChange,
  onClearHighlights,
  focusEffect,
  onFocusEffectChange,
}) {
  return (
    <section className="panel controls-panel" aria-label="PDF gaze controls">
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
          {isTracking ? '추적 중지' : 'MediaPipe 추적 시작'}
        </button>

        <button type="button" onClick={onRecalculate}>
          <RefreshCw size={18} />
          Text Layer 좌표 재계산
        </button>

        <button type="button" onClick={onCalibrate} disabled={!isTracking}>
          <Target size={18} />
          시선 보정 다시하기
        </button>

        <button type="button" onClick={onClearHighlights}>
          <Highlighter size={18} />
          하이라이트 초기화
        </button>

        <div className="effect-control">
          <span>보고 있는 영역 처리</span>
          <div className="effect-options" role="group" aria-label="보고 있는 영역 처리">
            {FOCUS_EFFECT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={focusEffect === option.value ? 'effect-option-active' : ''}
                aria-pressed={focusEffect === option.value}
                onClick={() => onFocusEffectChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="file-control">
          <FileUp size={18} />
          PDF 업로드
          <input type="file" accept="application/pdf" onChange={onFileChange} />
        </label>
      </div>
    </section>
  )
}
