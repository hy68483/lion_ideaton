import { useCallback, useEffect, useRef, useState } from 'react'
import webgazerScriptUrl from 'webgazer/dist/webgazer.js?url'
import { normalizeGazePoint } from '../utils/coordinate.js'

function getCameraErrorMessage(error) {
  const errorName = error?.name || ''
  const errorMessage = error?.message || ''

  if (errorName === 'NotAllowedError' || /permission denied/i.test(errorMessage)) {
    return '웹캠 권한이 거부되었습니다. 주소창 왼쪽 자물쇠/카메라 아이콘에서 카메라 권한을 허용한 뒤 새로고침해 주세요.'
  }

  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return '사용 가능한 웹캠을 찾지 못했습니다. 카메라 연결 상태를 확인해 주세요.'
  }

  if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
    return '웹캠을 다른 앱이 사용 중입니다. Zoom, Teams, 카메라 앱 등을 종료한 뒤 다시 시도해 주세요.'
  }

  if (errorName === 'SecurityError') {
    return '브라우저 보안 정책으로 카메라를 열 수 없습니다. https://localhost:5173 주소로 접속해 주세요.'
  }

  return errorMessage || '웹캠 권한 요청 중 오류가 발생했습니다.'
}

function pinWebGazerPreviewToBottomLeft() {
  const container = document.getElementById('webgazerVideoContainer')
  const video =
    document.getElementById('webgazerVideoFeed') ||
    document.querySelector('video[srcObject], video[autoplay]')
  const overlay =
    document.getElementById('webgazerFaceOverlay') ||
    document.querySelector('canvas#webgazerFaceOverlay')
  const feedbackBox = document.getElementById('webgazerFaceFeedbackBox')

  if (container) {
    container.classList.add('webgazer-preview-bottom-left')
    Object.assign(container.style, {
      position: 'fixed',
      left: '18px',
      right: 'auto',
      top: 'auto',
      bottom: '18px',
      width: '220px',
      height: '165px',
      overflow: 'hidden',
      zIndex: '50',
      border: '2px solid #ffffff',
      borderRadius: '8px',
      background: '#111827',
      boxShadow: '0 14px 34px rgba(15, 23, 42, 0.28)',
      pointerEvents: 'none',
    })
  }

  ;[video, overlay].forEach((element) => {
    if (!element) return
    element.classList.add('webgazer-preview-media')
    element.classList.toggle('webgazer-preview-standalone', !container)
    Object.assign(element.style, {
      left: container ? '0' : '18px',
      right: 'auto',
      top: container ? '0' : 'auto',
      bottom: container ? 'auto' : '18px',
      width: '220px',
      height: '165px',
      zIndex: '51',
      objectFit: 'cover',
      pointerEvents: 'none',
    })
  })

  if (feedbackBox) {
    feedbackBox.classList.add('webgazer-feedback-hidden')
    feedbackBox.style.display = 'none'
  }
}

export function useWebGazer() {
  const webgazerRef = useRef(null)
  const predictionFrameRef = useRef(null)
  const previewIntervalRef = useRef(null)
  const previewObserverRef = useRef(null)
  const lastPredictionAtRef = useRef(0)
  const [gazePoint, setGazePoint] = useState(null)
  const [isTracking, setIsTracking] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const loadWebGazer = useCallback(async () => {
    if (webgazerRef.current) return webgazerRef.current

    if (!window.webgazer) {
      await new Promise((resolve, reject) => {
        const existingScript = document.querySelector(
          'script[data-webgazer-script="true"]',
        )

        if (existingScript) {
          existingScript.addEventListener('load', resolve, { once: true })
          existingScript.addEventListener('error', reject, { once: true })
          return
        }

        const script = document.createElement('script')
        script.src = webgazerScriptUrl
        script.async = true
        script.dataset.webgazerScript = 'true'
        script.onload = resolve
        script.onerror = () => reject(new Error('WebGazer 스크립트를 불러오지 못했습니다.'))
        document.head.appendChild(script)
      })
    }

    const webgazer = window.webgazer

    if (!webgazer) {
      throw new Error('WebGazer를 초기화하지 못했습니다.')
    }

    webgazerRef.current = webgazer
    return webgazer
  }, [])

  const stopPredictionLoop = useCallback(() => {
    if (predictionFrameRef.current) {
      window.cancelAnimationFrame(predictionFrameRef.current)
      predictionFrameRef.current = null
    }
  }, [])

  const startPredictionLoop = useCallback((webgazer) => {
    stopPredictionLoop()

    const readPrediction = async () => {
      try {
        const prediction = await webgazer.getCurrentPrediction?.()
        const nextPoint = normalizeGazePoint(prediction)
        if (nextPoint) {
          lastPredictionAtRef.current = Date.now()
          setGazePoint({
            ...nextPoint,
            source: 'webgazer',
          })
        }
      } catch {
        // WebGazer가 보정 전 null/오류를 낼 수 있어서 다음 frame에서 다시 읽는다.
      } finally {
        predictionFrameRef.current = window.requestAnimationFrame(readPrediction)
      }
    }

    predictionFrameRef.current = window.requestAnimationFrame(readPrediction)
  }, [stopPredictionLoop])

  const startPreviewPinning = useCallback(() => {
    pinWebGazerPreviewToBottomLeft()
    window.setTimeout(pinWebGazerPreviewToBottomLeft, 100)
    window.setTimeout(pinWebGazerPreviewToBottomLeft, 500)
    window.clearInterval(previewIntervalRef.current)

    previewIntervalRef.current = window.setInterval(
      pinWebGazerPreviewToBottomLeft,
      1000,
    )

    previewObserverRef.current?.disconnect()
    previewObserverRef.current = new MutationObserver(() => {
      pinWebGazerPreviewToBottomLeft()
    })
    previewObserverRef.current.observe(document.body, {
      childList: true,
      subtree: true,
    })
  }, [])

  const stopPreviewPinning = useCallback(() => {
    window.clearInterval(previewIntervalRef.current)
    previewIntervalRef.current = null
    previewObserverRef.current?.disconnect()
    previewObserverRef.current = null
  }, [])

  const assertCameraApiAvailable = useCallback(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        '이 브라우저에서는 웹캠 API를 사용할 수 없습니다. Chrome 또는 Edge에서 다시 시도해 주세요.',
      )
    }
  }, [])

  const start = useCallback(async () => {
    try {
      setError('')
      setStatus('starting')

      // getUserMedia는 localhost 또는 HTTPS 같은 secure context에서만 동작한다.
      if (!window.isSecureContext) {
        throw new Error(
          'WebGazer는 HTTPS 또는 localhost에서만 사용할 수 있습니다. https://localhost:5173 으로 접속해 주세요.',
        )
      }

      assertCameraApiAvailable()

      const webgazer = await loadWebGazer()

      startPreviewPinning()

      // gaze listener는 viewport 기준 x/y 좌표만 앱 상태로 전달한다.
      webgazer.setGazeListener((data) => {
        const nextPoint = normalizeGazePoint(data)
        if (nextPoint) {
          lastPredictionAtRef.current = Date.now()
          setGazePoint({
            ...nextPoint,
            source: 'webgazer',
          })
        }
      })

      webgazer
        .showVideoPreview(true)
        .showPredictionPoints(false)
        .showFaceOverlay(false)
        .showFaceFeedbackBox(false)

      await webgazer.begin()
      startPreviewPinning()
      startPredictionLoop(webgazer)
      setIsTracking(true)
      setStatus('tracking')
      return true
    } catch (startError) {
      pinWebGazerPreviewToBottomLeft()
      setIsTracking(false)
      setStatus('error')
      setError(getCameraErrorMessage(startError))
      return false
    }
  }, [
    assertCameraApiAvailable,
    loadWebGazer,
    startPredictionLoop,
    startPreviewPinning,
  ])

  const recordCalibrationPoint = useCallback((x, y) => {
    const webgazer = webgazerRef.current
    if (!webgazer?.recordScreenPosition) return

    webgazer.recordScreenPosition(x, y, 'click')
  }, [])

  const stop = useCallback(() => {
    const webgazer = webgazerRef.current

    try {
      webgazer?.clearGazeListener?.()
      webgazer?.pause?.()
    } finally {
      stopPredictionLoop()
      stopPreviewPinning()
      setIsTracking(false)
      setStatus('paused')
    }
  }, [stopPredictionLoop, stopPreviewPinning])

  useEffect(() => {
    return () => {
      stopPredictionLoop()
      stopPreviewPinning()
      const webgazer = webgazerRef.current
      if (webgazer?.end) webgazer.end()
    }
  }, [stopPredictionLoop, stopPreviewPinning])

  return {
    gazePoint,
    isTracking,
    status,
    error,
    recordCalibrationPoint,
    start,
    stop,
  }
}
