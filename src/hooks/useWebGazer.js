import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeGazePoint } from '../utils/coordinate.js'

export function useWebGazer() {
  const webgazerRef = useRef(null)
  const [gazePoint, setGazePoint] = useState(null)
  const [isTracking, setIsTracking] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const loadWebGazer = useCallback(async () => {
    if (webgazerRef.current) return webgazerRef.current

    const module = await import('webgazer')
    const webgazer = module.default || window.webgazer

    if (!webgazer) {
      throw new Error('WebGazer를 불러오지 못했습니다.')
    }

    webgazerRef.current = webgazer
    return webgazer
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

      const webgazer = await loadWebGazer()

      // gaze listener는 viewport 기준 x/y 좌표만 앱 상태로 전달한다.
      webgazer.setGazeListener((data) => {
        const nextPoint = normalizeGazePoint(data)
        if (nextPoint) setGazePoint(nextPoint)
      })

      webgazer
        .showVideoPreview(true)
        .showPredictionPoints(false)
        .showFaceOverlay(false)
        .showFaceFeedbackBox(false)

      await webgazer.begin()
      setIsTracking(true)
      setStatus('tracking')
    } catch (startError) {
      setIsTracking(false)
      setStatus('error')
      setError(startError?.message || 'WebGazer 시작 중 오류가 발생했습니다.')
    }
  }, [loadWebGazer])

  const stop = useCallback(() => {
    const webgazer = webgazerRef.current
    if (!webgazer) return

    try {
      webgazer.clearGazeListener()
      webgazer.pause()
    } finally {
      setIsTracking(false)
      setStatus('paused')
    }
  }, [])

  useEffect(() => {
    return () => {
      const webgazer = webgazerRef.current
      if (webgazer?.end) webgazer.end()
    }
  }, [])

  return {
    gazePoint,
    isTracking,
    status,
    error,
    start,
    stop,
  }
}
