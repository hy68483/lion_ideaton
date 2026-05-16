import { useCallback, useEffect, useRef, useState } from 'react'
import webgazerScriptUrl from 'webgazer/dist/webgazer.js?url'
import { normalizeGazePoint } from '../utils/coordinate.js'

const MEDIAPIPE_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const FACE_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'
const ORT_WASM_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/'
const ONNX_GAZE_MODEL_URL = '/models/resnet34_gaze.onnx'
const ONNX_FALLBACK_GAZE_MODEL_URL = '/models/mobileone_s0_gaze.onnx'
const ONNX_INPUT_SIZE = 448
const ONNX_INFERENCE_INTERVAL_MS = 130
const ENABLE_AI_ASSIST = true
const ENABLE_ONNX_GAZE = false
const MEDIAPIPE_FRAME_INTERVAL_MS = 100
const MIN_CALIBRATION_SAMPLES = 45
const MIN_CALIBRATION_TARGETS = 9
const MAX_CALIBRATION_SAMPLES = 360
const CALIBRATION_CAPTURE_WINDOW_MS = 700
const FEATURE_HISTORY_LIMIT = 90
const MAX_FEATURES_PER_CLICK = 8
const MIN_RECENT_FEATURE_RECORDS = 6
const CALIBRATION_POINT_SETTLE_MS = 320
const MAX_CALIBRATION_FEATURE_SPREAD = 0.12
const MEDIAPIPE_WEIGHT = 0.56
const WEBGAZER_WEIGHT = 0.44
const FUSION_HISTORY_SIZE = 1
const HYBRID_HARD_DISAGREEMENT_PX = 170
const HYBRID_SOFT_DISAGREEMENT_PX = 360
const RIDGE_LAMBDA = 0.18
const HUBER_DELTA = 0.045
const ROBUST_FIT_ITERATIONS = 5
const OUTLIER_KEEP_RATIO = 0.84
const LOCAL_CORRECTION_NEIGHBORS = 18
const LOCAL_CORRECTION_GAIN = 0.22
const MAX_LOCAL_CORRECTION = 0.045
const ONE_EURO_MIN_CUTOFF = 14
const ONE_EURO_BETA = 0.2
const ONE_EURO_D_CUTOFF = 2.4
const FILTER_SNAP_DISTANCE_PX = 46
const MAX_FILTER_LAG_PX = 18

const LEFT_EYE = {
  outer: 33,
  inner: 133,
  top: 159,
  bottom: 145,
  iris: [468, 469, 470, 471, 472],
}
const RIGHT_EYE = {
  outer: 362,
  inner: 263,
  top: 386,
  bottom: 374,
  iris: [473, 474, 475, 476, 477],
}

function clampToViewport(point) {
  return {
    ...point,
    x: Math.min(window.innerWidth, Math.max(0, point.x)),
    y: Math.min(window.innerHeight, Math.max(0, point.y)),
  }
}

function getDistance(a, b) {
  if (!a || !b) return Infinity

  return Math.hypot(a.x - b.x, a.y - b.y)
}

function getMedianPoint(points) {
  const sortedX = points.map((point) => point.x).sort((a, b) => a - b)
  const sortedY = points.map((point) => point.y).sort((a, b) => a - b)
  const middle = Math.floor(points.length / 2)

  return {
    ...points.at(-1),
    x: sortedX[middle],
    y: sortedY[middle],
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function smoothingAlpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

function exponentialSmooth(current, previous, alpha) {
  return alpha * current + (1 - alpha) * previous
}

function applyOneEuroFilter(filterRef, point, now) {
  const previous = filterRef.current

  if (!previous) {
    filterRef.current = {
      timestamp: now,
      x: point.x,
      y: point.y,
      dx: 0,
      dy: 0,
    }
    return point
  }

  const dt = clamp((now - previous.timestamp) / 1000, 1 / 120, 0.12)
  const rawDx = (point.x - previous.x) / dt
  const rawDy = (point.y - previous.y) / dt
  const movement = Math.hypot(point.x - previous.x, point.y - previous.y)

  if (movement >= FILTER_SNAP_DISTANCE_PX) {
    filterRef.current = {
      timestamp: now,
      x: point.x,
      y: point.y,
      dx: rawDx,
      dy: rawDy,
    }

    return point
  }

  const derivativeAlpha = smoothingAlpha(ONE_EURO_D_CUTOFF, dt)
  const dx = exponentialSmooth(rawDx, previous.dx, derivativeAlpha)
  const dy = exponentialSmooth(rawDy, previous.dy, derivativeAlpha)
  const cutoffX = ONE_EURO_MIN_CUTOFF + ONE_EURO_BETA * Math.abs(dx)
  const cutoffY = ONE_EURO_MIN_CUTOFF + ONE_EURO_BETA * Math.abs(dy)
  let x = exponentialSmooth(point.x, previous.x, smoothingAlpha(cutoffX, dt))
  let y = exponentialSmooth(point.y, previous.y, smoothingAlpha(cutoffY, dt))
  const lag = Math.hypot(point.x - x, point.y - y)

  if (lag > MAX_FILTER_LAG_PX) {
    const lagRatio = MAX_FILTER_LAG_PX / lag
    x = point.x - (point.x - x) * lagRatio
    y = point.y - (point.y - y) * lagRatio
  }

  const filteredPoint = {
    ...point,
    x: Math.round(x),
    y: Math.round(y),
  }

  filterRef.current = {
    timestamp: now,
    x,
    y,
    dx,
    dy,
  }

  return filteredPoint
}

function softmax(values) {
  const maxValue = Math.max(...values)
  const exponents = values.map((value) => Math.exp(value - maxValue))
  const sum = exponents.reduce((acc, value) => acc + value, 0)

  return exponents.map((value) => value / sum)
}

function decodeOnnxGaze(yawLogits, pitchLogits) {
  const yawProbabilities = softmax(Array.from(yawLogits))
  const pitchProbabilities = softmax(Array.from(pitchLogits))
  const decode = (probabilities) =>
    probabilities.reduce((sum, probability, index) => sum + probability * index, 0) *
      4 -
    180

  return {
    yaw: (decode(yawProbabilities) * Math.PI) / 180,
    pitch: (decode(pitchProbabilities) * Math.PI) / 180,
    timestamp: Date.now(),
  }
}

function getMedianFeatureVector(records) {
  const featureSize = records[0]?.features.length || 0
  if (featureSize === 0) return null

  return Array.from({ length: featureSize }, (_, featureIndex) => {
    const values = records
      .map((record) => record.features[featureIndex])
      .filter(Number.isFinite)
      .sort((a, b) => a - b)

    return values[Math.floor(values.length / 2)]
  })
}

function getFeatureDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity

  const importantFeatureCount = Math.min(18, a.length)
  const sumOfSquares = a
    .slice(1, importantFeatureCount)
    .reduce((sum, value, index) => {
      const diff = value - b[index + 1]
      return sum + diff * diff
    }, 0)

  return Math.sqrt(sumOfSquares / Math.max(1, importantFeatureCount - 1))
}

function getCalibrationFeatureVectors(history, now, pointShownAt = 0) {
  const usableAfter = pointShownAt + CALIBRATION_POINT_SETTLE_MS
  const recentRecords = history.filter(
    (record) =>
      record.timestamp >= usableAfter &&
      now - record.timestamp <= CALIBRATION_CAPTURE_WINDOW_MS,
  )

  if (recentRecords.length < MIN_RECENT_FEATURE_RECORDS) return []

  const medianFeatures = getMedianFeatureVector(recentRecords)
  const featureSpread =
    recentRecords.reduce(
      (sum, record) => sum + getFeatureDistance(record.features, medianFeatures),
      0,
    ) / recentRecords.length

  if (featureSpread > MAX_CALIBRATION_FEATURE_SPREAD) {
    return []
  }

  const step = Math.max(1, Math.floor(recentRecords.length / MAX_FEATURES_PER_CLICK))
  const selectedRecords = recentRecords.filter((_, index) => index % step === 0)
  const featureVectors = selectedRecords
    .slice(-MAX_FEATURES_PER_CLICK)
    .map((record) => record.features)

  if (medianFeatures) {
    featureVectors.push(medianFeatures)
  }

  return featureVectors
}

function averageLandmark(landmarks, indices) {
  const validLandmarks = indices
    .map((index) => landmarks[index])
    .filter(Boolean)

  if (validLandmarks.length === 0) return null

  return validLandmarks.reduce(
    (acc, landmark) => ({
      x: acc.x + landmark.x / validLandmarks.length,
      y: acc.y + landmark.y / validLandmarks.length,
      z: acc.z + (landmark.z || 0) / validLandmarks.length,
    }),
    { x: 0, y: 0, z: 0 },
  )
}

function getEyeMetrics(landmarks, eye) {
  const outer = landmarks[eye.outer]
  const inner = landmarks[eye.inner]
  const top = landmarks[eye.top]
  const bottom = landmarks[eye.bottom]

  if (!outer || !inner || !top || !bottom) return null

  const center = {
    x: (outer.x + inner.x) / 2,
    y: (top.y + bottom.y) / 2,
  }
  const irisCenter = averageLandmark(landmarks, eye.iris) || center
  const width = Math.max(Math.abs(inner.x - outer.x), 0.001)
  const height = Math.max(Math.abs(bottom.y - top.y), 0.001)

  return {
    center,
    width,
    height,
    irisDx: (irisCenter.x - center.x) / width,
    irisDy: (irisCenter.y - center.y) / height,
  }
}

function getFaceBounds(landmarks) {
  const bounds = landmarks.reduce(
    (acc, landmark) => ({
      left: Math.min(acc.left, landmark.x),
      right: Math.max(acc.right, landmark.x),
      top: Math.min(acc.top, landmark.y),
      bottom: Math.max(acc.bottom, landmark.y),
    }),
    { left: 1, right: 0, top: 1, bottom: 0 },
  )

  return {
    ...bounds,
    width: Math.max(bounds.right - bounds.left, 0.001),
    height: Math.max(bounds.bottom - bounds.top, 0.001),
    centerX: (bounds.left + bounds.right) / 2,
    centerY: (bounds.top + bounds.bottom) / 2,
  }
}

function getFacePoseFeatures(faceMatrix) {
  const data = faceMatrix?.data || faceMatrix || []

  if (data.length < 16) {
    return Array.from({ length: 16 }, () => 0)
  }

  const pose = Array.from(data.slice(0, 16)).map((value) =>
    Number.isFinite(value) ? value : 0,
  )

  return [
    ...pose.slice(0, 12),
    pose[12] / 100,
    pose[13] / 100,
    pose[14] / 100,
    pose[15],
  ]
}

function buildFeatureVector(landmarks, webgazerPoint, onnxGaze, faceMatrix) {
  if (!landmarks?.length) return null

  const leftEye = getEyeMetrics(landmarks, LEFT_EYE)
  const rightEye = getEyeMetrics(landmarks, RIGHT_EYE)
  const nose = landmarks[1] || landmarks[4]

  if (!leftEye || !rightEye || !nose) return null

  const face = getFaceBounds(landmarks)
  const avgIrisDx = (leftEye.irisDx + rightEye.irisDx) / 2
  const avgIrisDy = (leftEye.irisDy + rightEye.irisDy) / 2
  const eyeRoll = Math.atan2(
    rightEye.center.y - leftEye.center.y,
    rightEye.center.x - leftEye.center.x,
  )
  const webgazerX = webgazerPoint ? webgazerPoint.x / window.innerWidth : 0.5
  const webgazerY = webgazerPoint ? webgazerPoint.y / window.innerHeight : 0.5
  const hasFreshOnnxGaze =
    onnxGaze && Date.now() - onnxGaze.timestamp < ONNX_INFERENCE_INTERVAL_MS * 5
  const onnxYaw = hasFreshOnnxGaze ? onnxGaze.yaw : 0
  const onnxPitch = hasFreshOnnxGaze ? onnxGaze.pitch : 0
  const noseDx = (nose.x - face.centerX) / face.width
  const noseDy = (nose.y - face.centerY) / face.height
  const eyeGap = Math.max(rightEye.center.x - leftEye.center.x, 0.001)
  const eyeCenterY = (leftEye.center.y + rightEye.center.y) / 2
  const eyeCenterX = (leftEye.center.x + rightEye.center.x) / 2
  const poseFeatures = getFacePoseFeatures(faceMatrix)
  const baseFeatures = [
    1,
    leftEye.irisDx,
    leftEye.irisDy,
    rightEye.irisDx,
    rightEye.irisDy,
    avgIrisDx,
    avgIrisDy,
    noseDx,
    noseDy,
    face.centerX,
    face.centerY,
    face.width,
    face.height,
    eyeRoll,
    leftEye.center.x,
    leftEye.center.y,
    rightEye.center.x,
    rightEye.center.y,
    webgazerX,
    webgazerY,
    webgazerPoint ? 1 : 0,
    onnxYaw,
    onnxPitch,
    Math.sin(onnxYaw),
    Math.sin(onnxPitch),
    Math.cos(onnxYaw),
    Math.cos(onnxPitch),
    hasFreshOnnxGaze ? 1 : 0,
    ...poseFeatures,
  ]

  return [
    ...baseFeatures,
    avgIrisDx * avgIrisDx,
    avgIrisDy * avgIrisDy,
    avgIrisDx * avgIrisDy,
    noseDx * noseDx,
    noseDy * noseDy,
    noseDx * avgIrisDx,
    noseDy * avgIrisDy,
    eyeGap,
    eyeCenterX,
    eyeCenterY,
    webgazerX * webgazerX,
    webgazerY * webgazerY,
    webgazerX * webgazerY,
    onnxYaw * onnxYaw,
    onnxPitch * onnxPitch,
    onnxYaw * onnxPitch,
    onnxYaw * avgIrisDx,
    onnxPitch * avgIrisDy,
  ]
}

const FEATURE_INDEXES = {
  bias: 0,
  eyeCore: Array.from({ length: 17 }, (_, index) => index + 1),
  webgazer: [18, 19, 20, 54, 55, 56],
  onnx: [21, 22, 23, 24, 25, 26, 27, 57, 58, 59, 60, 61],
  pose: Array.from({ length: 16 }, (_, index) => index + 28),
  eyeInteraction: Array.from({ length: 10 }, (_, index) => index + 44),
}

const CALIBRATION_CANDIDATES = [
  {
    name: 'webgazer-safe',
    featureIndexes: [FEATURE_INDEXES.bias, ...FEATURE_INDEXES.webgazer],
    complexityPenalty: 0.012,
  },
  {
    name: 'eye-core',
    featureIndexes: [
      FEATURE_INDEXES.bias,
      ...FEATURE_INDEXES.eyeCore,
      ...FEATURE_INDEXES.eyeInteraction,
    ],
    complexityPenalty: 0.02,
  },
  {
    name: 'eye-webgazer',
    featureIndexes: [
      FEATURE_INDEXES.bias,
      ...FEATURE_INDEXES.eyeCore,
      ...FEATURE_INDEXES.eyeInteraction,
      ...FEATURE_INDEXES.webgazer,
    ],
    complexityPenalty: 0.024,
  },
  {
    name: 'eye-pose-webgazer',
    featureIndexes: [
      FEATURE_INDEXES.bias,
      ...FEATURE_INDEXES.eyeCore,
      ...FEATURE_INDEXES.eyeInteraction,
      ...FEATURE_INDEXES.pose,
      ...FEATURE_INDEXES.webgazer,
    ],
    complexityPenalty: 0.032,
  },
  {
    name: 'full-onnx',
    featureIndexes: [
      FEATURE_INDEXES.bias,
      ...FEATURE_INDEXES.eyeCore,
      ...FEATURE_INDEXES.eyeInteraction,
      ...FEATURE_INDEXES.pose,
      ...FEATURE_INDEXES.webgazer,
      ...FEATURE_INDEXES.onnx,
    ],
    complexityPenalty: 0.042,
  },
]

function selectFeatures(features, featureIndexes) {
  return featureIndexes.map((index, selectedIndex) => {
    if (selectedIndex === 0) return 1
    const value = features[index]
    return Number.isFinite(value) ? value : 0
  })
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length
  const rows = matrix.map((row, index) => [...row, vector[index]])

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivotRow][column])) {
        pivotRow = row
      }
    }

    if (Math.abs(rows[pivotRow][column]) < 1e-10) return null

    if (pivotRow !== column) {
      ;[rows[column], rows[pivotRow]] = [rows[pivotRow], rows[column]]
    }

    const pivot = rows[column][column]
    for (let cell = column; cell <= size; cell += 1) {
      rows[column][cell] /= pivot
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue

      const factor = rows[row][column]
      for (let cell = column; cell <= size; cell += 1) {
        rows[row][cell] -= factor * rows[column][cell]
      }
    }
  }

  return rows.map((row) => row[size])
}

function computeFeatureStats(samples) {
  const featureSize = samples[0]?.features.length || 0
  const mean = Array.from({ length: featureSize }, () => 0)
  const std = Array.from({ length: featureSize }, () => 1)

  if (featureSize === 0) return { mean, std }

  samples.forEach((sample) => {
    sample.features.forEach((value, index) => {
      if (index === 0) return
      mean[index] += value / samples.length
    })
  })

  for (let index = 1; index < featureSize; index += 1) {
    const variance =
      samples.reduce((sum, sample) => {
        const diff = sample.features[index] - mean[index]
        return sum + diff * diff
      }, 0) / Math.max(1, samples.length - 1)

    std[index] = Math.max(Math.sqrt(variance), 1e-4)
  }

  return { mean, std }
}

function transformFeatures(features, stats) {
  return features.map((value, index) => {
    if (index === 0) return 1
    return (value - stats.mean[index]) / stats.std[index]
  })
}

function transformSamples(samples, stats) {
  return samples.map((sample) => ({
    ...sample,
    features: transformFeatures(sample.features, stats),
  }))
}

function fitWeightedRidgeModel(transformedSamples, weights) {
  const featureSize = transformedSamples[0]?.features.length || 0
  if (
    transformedSamples.length < MIN_CALIBRATION_SAMPLES ||
    featureSize === 0
  ) {
    return null
  }

  const xtx = Array.from({ length: featureSize }, () =>
    Array.from({ length: featureSize }, () => 0),
  )
  const xtyX = Array.from({ length: featureSize }, () => 0)
  const xtyY = Array.from({ length: featureSize }, () => 0)

  transformedSamples.forEach((sample, sampleIndex) => {
    const sampleWeight = weights?.[sampleIndex] ?? 1

    sample.features.forEach((featureValue, row) => {
      xtyX[row] += sampleWeight * featureValue * sample.targetX
      xtyY[row] += sampleWeight * featureValue * sample.targetY

      sample.features.forEach((otherFeatureValue, column) => {
        xtx[row][column] += sampleWeight * featureValue * otherFeatureValue
      })
    })
  })

  for (let index = 0; index < featureSize; index += 1) {
    xtx[index][index] += index === 0 ? RIDGE_LAMBDA * 0.15 : RIDGE_LAMBDA
  }

  const weightsX = solveLinearSystem(xtx, xtyX)
  const weightsY = solveLinearSystem(xtx, xtyY)

  if (!weightsX || !weightsY) return null

  return { weightsX, weightsY }
}

function predictTransformed(model, transformedFeatures) {
  const normalizedX = model.weightsX.reduce(
    (sum, weight, index) => sum + weight * transformedFeatures[index],
    0,
  )
  const normalizedY = model.weightsY.reduce(
    (sum, weight, index) => sum + weight * transformedFeatures[index],
    0,
  )

  return {
    x: normalizedX,
    y: normalizedY,
  }
}

function getModelResidual(model, transformedSample) {
  const prediction = predictTransformed(model, transformedSample.features)
  return Math.hypot(
    prediction.x - transformedSample.targetX,
    prediction.y - transformedSample.targetY,
  )
}

function getTransformedFeatureDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity

  const sumOfSquares = a.slice(1).reduce((sum, value, index) => {
    const diff = value - b[index + 1]
    return sum + diff * diff
  }, 0)

  return Math.sqrt(sumOfSquares / Math.max(1, a.length - 1))
}

function getResidualPercentile(residuals, percentile) {
  if (residuals.length === 0) return 0

  const sortedResiduals = [...residuals].sort((a, b) => a - b)
  const index = Math.min(
    sortedResiduals.length - 1,
    Math.floor(sortedResiduals.length * percentile),
  )

  return sortedResiduals[index]
}

function buildLocalCorrectionSamples(model, transformedSamples) {
  return transformedSamples.map((sample) => {
    const prediction = predictTransformed(model, sample.features)

    return {
      features: sample.features,
      targetX: sample.targetX,
      targetY: sample.targetY,
      residualX: sample.targetX - prediction.x,
      residualY: sample.targetY - prediction.y,
      residual: Math.hypot(prediction.x - sample.targetX, prediction.y - sample.targetY),
    }
  })
}

function fitCalibrationModelCore(samples) {
  const stats = computeFeatureStats(samples)
  const transformedSamples = transformSamples(samples, stats)
  let weights = Array.from({ length: transformedSamples.length }, () => 1)
  let currentModel = null

  for (let iteration = 0; iteration < ROBUST_FIT_ITERATIONS; iteration += 1) {
    currentModel = fitWeightedRidgeModel(transformedSamples, weights)
    if (!currentModel) break

    weights = transformedSamples.map((sample) => {
      const residual = getModelResidual(currentModel, sample)
      if (residual <= HUBER_DELTA) return 1
      return HUBER_DELTA / Math.max(residual, 1e-6)
    })
  }

  if (!currentModel) return null

  const residuals = transformedSamples.map((sample) =>
    getModelResidual(currentModel, sample),
  )

  if (samples.length >= MIN_CALIBRATION_SAMPLES * 2) {
    const residualCutoff = getResidualPercentile(
      residuals,
      OUTLIER_KEEP_RATIO,
    )
    const filteredSamples = transformedSamples.filter(
      (sample, index) => residuals[index] <= residualCutoff,
    )

    const filteredWeights = filteredSamples.map(() => 1)
    const refinedModel = fitWeightedRidgeModel(filteredSamples, filteredWeights)

    if (refinedModel) {
      currentModel = refinedModel
    }
  }

  const finalResiduals = transformedSamples.map((sample) =>
    getModelResidual(currentModel, sample),
  )
  const localCorrectionSamples = buildLocalCorrectionSamples(
    currentModel,
    transformedSamples,
  )
  const nearestDistances = localCorrectionSamples
    .map((sample, index) => {
      const distances = localCorrectionSamples
        .filter((_, otherIndex) => otherIndex !== index)
        .map((otherSample) =>
          getTransformedFeatureDistance(sample.features, otherSample.features),
        )
        .sort((a, b) => a - b)

      return distances[0] || 1
    })
    .filter(Number.isFinite)
  const localBandwidth = clamp(
    getResidualPercentile(nearestDistances, 0.55) * 2.1 || 1.2,
    0.35,
    3.5,
  )

  return {
    ...currentModel,
    stats,
    localCorrectionSamples,
    localBandwidth,
    sampleCount: samples.length,
    meanResidual:
      finalResiduals.reduce((sum, residual) => sum + residual, 0) /
      Math.max(1, finalResiduals.length),
    residualP90: getResidualPercentile(finalResiduals, 0.9),
  }
}

function getDistinctTargetCount(samples) {
  return new Set(
    samples.map(
      (sample) =>
        sample.targetKey ||
        `${Math.round(sample.targetX * 1000)}:${Math.round(sample.targetY * 1000)}`,
    ),
  ).size
}

function buildCandidateSamples(samples, featureIndexes) {
  return samples.map((sample) => ({
    ...sample,
    features: selectFeatures(sample.features, featureIndexes),
  }))
}

function splitCalibrationSamples(samples) {
  const groupedSamples = new Map()

  samples.forEach((sample) => {
    const key =
      sample.targetKey ||
      `${Math.round(sample.targetX * 1000)}:${Math.round(sample.targetY * 1000)}`
    const group = groupedSamples.get(key) || []

    group.push(sample)
    groupedSamples.set(key, group)
  })

  const trainSamples = []
  const validationSamples = []
  const targetGroups = Array.from(groupedSamples.values())

  targetGroups.forEach((group, groupIndex) => {
    const shouldHoldOutTarget =
      targetGroups.length >= MIN_CALIBRATION_TARGETS && groupIndex % 4 === 1

    if (shouldHoldOutTarget) {
      validationSamples.push(...group)
    } else {
      trainSamples.push(...group)
    }
  })

  return { trainSamples, validationSamples }
}

function predictNormalizedFromModel(model, features, shouldUseLocalCorrection = true) {
  const transformedFeatures = transformFeatures(features, model.stats)
  const globalPrediction = predictTransformed(model, transformedFeatures)
  const localCorrection = shouldUseLocalCorrection
    ? getLocalResidualCorrection(model, transformedFeatures)
    : { x: 0, y: 0, confidence: 0 }

  return {
    x: clamp(globalPrediction.x + localCorrection.x, 0, 1),
    y: clamp(globalPrediction.y + localCorrection.y, 0, 1),
    confidence: localCorrection.confidence,
  }
}

function getPixelResidual(model, sample, shouldUseLocalCorrection = false) {
  const prediction = predictNormalizedFromModel(
    model,
    sample.features,
    shouldUseLocalCorrection,
  )
  const dx = (prediction.x - sample.targetX) * window.innerWidth
  const dy = (prediction.y - sample.targetY) * window.innerHeight

  return Math.hypot(dx, dy)
}

function scoreCalibrationCandidate(samples) {
  const { trainSamples, validationSamples } = splitCalibrationSamples(samples)

  if (
    trainSamples.length < MIN_CALIBRATION_SAMPLES ||
    validationSamples.length < Math.max(12, MIN_CALIBRATION_TARGETS)
  ) {
    const fallbackModel = fitCalibrationModelCore(samples)
    if (!fallbackModel) return null

    const trainingResiduals = samples.map((sample) =>
      getPixelResidual(fallbackModel, sample, false),
    )

    return {
      model: fallbackModel,
      validationMedianPx: getResidualPercentile(trainingResiduals, 0.5),
      validationP90Px: getResidualPercentile(trainingResiduals, 0.9),
      usedHoldout: false,
    }
  }

  const model = fitCalibrationModelCore(trainSamples)
  if (!model) return null

  const validationResiduals = validationSamples.map((sample) =>
    getPixelResidual(model, sample, false),
  )

  return {
    model,
    validationMedianPx: getResidualPercentile(validationResiduals, 0.5),
    validationP90Px: getResidualPercentile(validationResiduals, 0.9),
    usedHoldout: true,
  }
}

function isCalibrationModelReliable(model) {
  if (!model) return false

  const viewportGate = clamp(
    Math.min(window.innerWidth, window.innerHeight) * 0.1,
    70,
    115,
  )

  return (
    model.usedHoldout &&
    model.distinctTargets >= MIN_CALIBRATION_TARGETS &&
    model.validationMedianPx <= viewportGate &&
    model.validationP90Px <= viewportGate * 1.9
  )
}

function fitCalibrationModel(samples) {
  if (
    samples.length < MIN_CALIBRATION_SAMPLES ||
    getDistinctTargetCount(samples) < MIN_CALIBRATION_TARGETS
  ) {
    return null
  }

  const scoredCandidates = CALIBRATION_CANDIDATES.map((candidate) => {
    const candidateSamples = buildCandidateSamples(samples, candidate.featureIndexes)
    const score = scoreCalibrationCandidate(candidateSamples)

    if (!score) return null

    return {
      ...candidate,
      ...score,
      selectionScore:
        score.validationMedianPx +
        score.validationP90Px * 0.22 +
        candidate.complexityPenalty * window.innerWidth,
    }
  })
    .filter(Boolean)
    .sort((a, b) => a.selectionScore - b.selectionScore)

  const bestCandidate = scoredCandidates[0]
  if (!bestCandidate) return null

  const selectedSamples = buildCandidateSamples(
    samples,
    bestCandidate.featureIndexes,
  )
  const finalModel = fitCalibrationModelCore(selectedSamples)
  if (!finalModel) return null

  const model = {
    ...finalModel,
    candidateName: bestCandidate.name,
    featureIndexes: bestCandidate.featureIndexes,
    validationMedianPx: Math.round(bestCandidate.validationMedianPx),
    validationP90Px: Math.round(bestCandidate.validationP90Px),
    usedHoldout: bestCandidate.usedHoldout,
    distinctTargets: getDistinctTargetCount(samples),
  }

  return {
    ...model,
    isReliable: isCalibrationModelReliable(model),
  }
}

function getLocalResidualCorrection(model, transformedFeatures) {
  if (!model.localCorrectionSamples?.length) return { x: 0, y: 0, confidence: 0 }

  const neighbors = model.localCorrectionSamples
    .map((sample) => ({
      sample,
      distance: getTransformedFeatureDistance(transformedFeatures, sample.features),
    }))
    .filter((item) => Number.isFinite(item.distance))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, LOCAL_CORRECTION_NEIGHBORS)

  if (neighbors.length === 0) return { x: 0, y: 0, confidence: 0 }

  const bandwidth = Math.max(model.localBandwidth || 1, 0.2)
  let totalWeight = 0
  let correctionX = 0
  let correctionY = 0

  neighbors.forEach(({ sample, distance }) => {
    const kernelWeight = Math.exp(-(distance * distance) / (2 * bandwidth * bandwidth))
    const residualWeight = 1 / (1 + sample.residual / HUBER_DELTA)
    const weight = kernelWeight * residualWeight

    totalWeight += weight
    correctionX += weight * sample.residualX
    correctionY += weight * sample.residualY
  })

  if (totalWeight <= 0) return { x: 0, y: 0, confidence: 0 }

  const nearestDistance = neighbors[0].distance
  const confidence = clamp(1 - nearestDistance / (bandwidth * 3), 0, 1)

  return {
    x: clamp(
      (correctionX / totalWeight) * LOCAL_CORRECTION_GAIN,
      -MAX_LOCAL_CORRECTION,
      MAX_LOCAL_CORRECTION,
    ),
    y: clamp(
      (correctionY / totalWeight) * LOCAL_CORRECTION_GAIN,
      -MAX_LOCAL_CORRECTION,
      MAX_LOCAL_CORRECTION,
    ),
    confidence,
  }
}

function predictFromModel(model, features) {
  const selectedFeatures = model.featureIndexes
    ? selectFeatures(features, model.featureIndexes)
    : features
  const prediction = predictNormalizedFromModel(
    model,
    selectedFeatures,
    model.isReliable !== false,
  )

  return clampToViewport({
    x: Math.round(prediction.x * window.innerWidth),
    y: Math.round(prediction.y * window.innerHeight),
    timestamp: Date.now(),
    modelConfidence: prediction.confidence,
  })
}

function getTrackerEngineName(model, onnxModelName = '') {
  if (!ENABLE_AI_ASSIST) {
    return 'WebGazer fast mode'
  }

  if (!model) {
    return ENABLE_ONNX_GAZE
      ? `WebGazer + MediaPipe + ONNX ${onnxModelName}`.trim()
      : 'WebGazer + MediaPipe'
  }

  if (!model.isReliable) {
    return `WebGazer · hybrid rejected (${model.candidateName})`
  }

  return ENABLE_ONNX_GAZE
    ? `Hybrid ${model.candidateName} + ONNX ${onnxModelName}`.trim()
    : `Hybrid ${model.candidateName}`
}

function getWebGazerVideoElement() {
  return (
    document.getElementById('webgazerVideoFeed') ||
    document.querySelector('#webgazerVideoContainer video') ||
    document.querySelector('video[srcObject], video[autoplay]')
  )
}

function getFaceCropBox(landmarks, video) {
  const face = getFaceBounds(landmarks)
  const videoWidth = video.videoWidth || video.clientWidth
  const videoHeight = video.videoHeight || video.clientHeight
  const centerX = face.centerX * videoWidth
  const centerY = face.centerY * videoHeight
  const faceWidth = face.width * videoWidth
  const faceHeight = face.height * videoHeight
  const cropSize = Math.max(faceWidth * 1.55, faceHeight * 1.25, 96)
  const left = Math.max(0, Math.round(centerX - cropSize / 2))
  const top = Math.max(0, Math.round(centerY - cropSize * 0.46))
  const size = Math.round(
    Math.min(cropSize, videoWidth - left, videoHeight - top),
  )

  if (size <= 0) return null

  return {
    left,
    top,
    size,
  }
}

function createOnnxInputTensor(video, landmarks, canvas, ortRuntime) {
  const cropBox = getFaceCropBox(landmarks, video)
  if (!cropBox) return null

  canvas.width = ONNX_INPUT_SIZE
  canvas.height = ONNX_INPUT_SIZE

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  context.drawImage(
    video,
    cropBox.left,
    cropBox.top,
    cropBox.size,
    cropBox.size,
    0,
    0,
    ONNX_INPUT_SIZE,
    ONNX_INPUT_SIZE,
  )

  const imageData = context.getImageData(0, 0, ONNX_INPUT_SIZE, ONNX_INPUT_SIZE)
  const pixels = imageData.data
  const imageSize = ONNX_INPUT_SIZE * ONNX_INPUT_SIZE
  const input = new Float32Array(3 * imageSize)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]

  for (let pixelIndex = 0; pixelIndex < imageSize; pixelIndex += 1) {
    const sourceIndex = pixelIndex * 4
    input[pixelIndex] = (pixels[sourceIndex] / 255 - mean[0]) / std[0]
    input[imageSize + pixelIndex] =
      (pixels[sourceIndex + 1] / 255 - mean[1]) / std[1]
    input[imageSize * 2 + pixelIndex] =
      (pixels[sourceIndex + 2] / 255 - mean[2]) / std[2]
  }

  return new ortRuntime.Tensor('float32', input, [
    1,
    3,
    ONNX_INPUT_SIZE,
    ONNX_INPUT_SIZE,
  ])
}

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
  const faceLandmarkerRef = useRef(null)
  const onnxRuntimeRef = useRef(null)
  const onnxSessionRef = useRef(null)
  const onnxInputNameRef = useRef('')
  const onnxOutputNamesRef = useRef([])
  const onnxModelNameRef = useRef('')
  const onnxCanvasRef = useRef(null)
  const onnxRunningRef = useRef(false)
  const lastOnnxRunAtRef = useRef(0)
  const mediaPipeFrameRef = useRef(null)
  const predictionFrameRef = useRef(null)
  const previewIntervalRef = useRef(null)
  const previewObserverRef = useRef(null)
  const lastPredictionAtRef = useRef(0)
  const lastMediaPipeRunAtRef = useRef(0)
  const latestWebGazerPointRef = useRef(null)
  const latestMediaPipePointRef = useRef(null)
  const latestOnnxGazeRef = useRef(null)
  const latestFeatureVectorRef = useRef(null)
  const featureHistoryRef = useRef([])
  const calibrationSamplesRef = useRef([])
  const calibrationModelRef = useRef(null)
  const fusedHistoryRef = useRef([])
  const oneEuroFilterRef = useRef(null)
  const lastInfoUpdateRef = useRef(0)
  const faceDetectedRef = useRef(false)
  const [gazePoint, setGazePoint] = useState(null)
  const [isTracking, setIsTracking] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [trackerInfo, setTrackerInfo] = useState({
    engine: getTrackerEngineName(null, ''),
    calibrationSamples: 0,
    isHybridCalibrated: false,
    isHybridReliable: false,
    calibrationModelName: '',
    calibrationErrorPx: null,
    mediaPipeReady: false,
    onnxReady: false,
    faceDetected: false,
  })

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

  const loadFaceLandmarker = useCallback(async () => {
    if (!ENABLE_AI_ASSIST) return null
    if (faceLandmarkerRef.current) return faceLandmarkerRef.current

    const { FaceLandmarker, FilesetResolver } = await import(
      '@mediapipe/tasks-vision'
    )
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL)
    const baseOptions = {
      modelAssetPath: FACE_LANDMARKER_MODEL_URL,
      delegate: 'GPU',
    }

    try {
      faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
        baseOptions,
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      })
    } catch {
      faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL_URL,
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      })
    }

    setTrackerInfo((info) => ({
      ...info,
      mediaPipeReady: true,
      engine: getTrackerEngineName(
        calibrationModelRef.current,
        onnxModelNameRef.current,
      ),
    }))

    return faceLandmarkerRef.current
  }, [])

  const loadOnnxGazeModel = useCallback(async () => {
    if (!ENABLE_AI_ASSIST || !ENABLE_ONNX_GAZE) return null
    if (onnxSessionRef.current) return onnxSessionRef.current

    const ortRuntime = onnxRuntimeRef.current || (await import('onnxruntime-web'))
    ortRuntime.env.wasm.wasmPaths = ORT_WASM_URL
    onnxRuntimeRef.current = ortRuntime

    let session
    let modelName = 'ResNet-34'

    try {
      session = await ortRuntime.InferenceSession.create(ONNX_GAZE_MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
    } catch {
      modelName = 'MobileOne S0'
      session = await ortRuntime.InferenceSession.create(
        ONNX_FALLBACK_GAZE_MODEL_URL,
        {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        },
      )
    }

    onnxSessionRef.current = session
    onnxModelNameRef.current = modelName
    onnxInputNameRef.current = session.inputNames[0] || 'input'
    onnxOutputNamesRef.current = session.outputNames
    onnxCanvasRef.current = document.createElement('canvas')

    setTrackerInfo((info) => ({
      ...info,
      onnxReady: true,
      engine: getTrackerEngineName(calibrationModelRef.current, modelName),
    }))

    return session
  }, [])

  const stopPredictionLoop = useCallback(() => {
    if (predictionFrameRef.current) {
      window.cancelAnimationFrame(predictionFrameRef.current)
      predictionFrameRef.current = null
    }
  }, [])

  const stopMediaPipeLoop = useCallback(() => {
    if (mediaPipeFrameRef.current) {
      window.cancelAnimationFrame(mediaPipeFrameRef.current)
      mediaPipeFrameRef.current = null
    }
  }, [])

  const publishFusedPoint = useCallback(() => {
    const now = Date.now()
    const webgazerPoint = latestWebGazerPointRef.current
    const mediaPipePoint = latestMediaPipePointRef.current
    const hasFreshWebGazer = webgazerPoint && now - webgazerPoint.timestamp < 350
    const hasFreshMediaPipe =
      mediaPipePoint &&
      calibrationModelRef.current &&
      calibrationModelRef.current.isReliable &&
      now - mediaPipePoint.timestamp < 350

    if (!hasFreshWebGazer && !hasFreshMediaPipe) return

    let fusedPoint
    let source = 'webgazer'
    let confidence = 0.45

    if (hasFreshWebGazer && hasFreshMediaPipe) {
      const disagreement = getDistance(webgazerPoint, mediaPipePoint)
      const localConfidence = mediaPipePoint.modelConfidence ?? 0.5
      const disagreementPenalty = clamp(
        1 - disagreement / HYBRID_SOFT_DISAGREEMENT_PX,
        0,
        1,
      )

      if (disagreement > HYBRID_HARD_DISAGREEMENT_PX) {
        fusedPoint = { ...webgazerPoint, timestamp: now }
        source = 'webgazer-guard'
        confidence = 0.42
      } else {
        const mediaPipeWeight = clamp(
          MEDIAPIPE_WEIGHT * (0.45 + localConfidence * 0.45) * disagreementPenalty,
          0.08,
          0.62,
        )
        const webgazerWeight = clamp(
          WEBGAZER_WEIGHT * (1.35 - localConfidence * 0.3),
          0.32,
          0.8,
        )
        const totalWeight = mediaPipeWeight + webgazerWeight

        fusedPoint = {
          x: Math.round(
            (mediaPipePoint.x * mediaPipeWeight + webgazerPoint.x * webgazerWeight) /
              totalWeight,
          ),
          y: Math.round(
            (mediaPipePoint.y * mediaPipeWeight + webgazerPoint.y * webgazerWeight) /
              totalWeight,
          ),
          timestamp: now,
        }
        source = 'hybrid'
        confidence = clamp(
          0.5 + localConfidence * 0.22 + disagreementPenalty * 0.18,
          0.45,
          0.9,
        )
      }
    } else if (hasFreshMediaPipe) {
      fusedPoint = { ...mediaPipePoint, timestamp: now }
      source = 'mediapipe'
      confidence = clamp(0.55 + (mediaPipePoint.modelConfidence ?? 0.4) * 0.35, 0.55, 0.9)
    } else {
      fusedPoint = { ...webgazerPoint, timestamp: now }
    }

    fusedHistoryRef.current = [...fusedHistoryRef.current, fusedPoint].slice(
      -FUSION_HISTORY_SIZE,
    )

    const medianPoint = getMedianPoint(fusedHistoryRef.current)
    const stabilizedPoint = applyOneEuroFilter(oneEuroFilterRef, medianPoint, now)

    setGazePoint({
      ...stabilizedPoint,
      rawX: webgazerPoint?.x,
      rawY: webgazerPoint?.y,
      mediaPipeX: mediaPipePoint?.x,
      mediaPipeY: mediaPipePoint?.y,
      source,
      confidence,
    })

    if (now - lastInfoUpdateRef.current > 250) {
      lastInfoUpdateRef.current = now
      setTrackerInfo({
        engine: getTrackerEngineName(
          calibrationModelRef.current,
          onnxModelNameRef.current,
        ),
        calibrationSamples: calibrationSamplesRef.current.length,
        isHybridCalibrated: Boolean(calibrationModelRef.current),
        isHybridReliable: Boolean(calibrationModelRef.current?.isReliable),
        calibrationModelName: calibrationModelRef.current?.candidateName || '',
        calibrationErrorPx: calibrationModelRef.current
          ? {
              median: calibrationModelRef.current.validationMedianPx,
              p90: calibrationModelRef.current.validationP90Px,
            }
          : null,
        mediaPipeReady: Boolean(faceLandmarkerRef.current),
        onnxReady: Boolean(onnxSessionRef.current),
        faceDetected: faceDetectedRef.current,
      })
    }
  }, [])

  const runOnnxGaze = useCallback(async (video, landmarks) => {
    if (!ENABLE_AI_ASSIST || !ENABLE_ONNX_GAZE) return

    const session = onnxSessionRef.current
    const ortRuntime = onnxRuntimeRef.current
    const canvas = onnxCanvasRef.current
    const inputName = onnxInputNameRef.current
    const outputNames = onnxOutputNamesRef.current

    if (!session || !ortRuntime || !canvas || !inputName || onnxRunningRef.current) return

    const now = Date.now()
    if (now - lastOnnxRunAtRef.current < ONNX_INFERENCE_INTERVAL_MS) return

    const tensor = createOnnxInputTensor(video, landmarks, canvas, ortRuntime)
    if (!tensor) return

    onnxRunningRef.current = true
    lastOnnxRunAtRef.current = now

    try {
      const result = await session.run({ [inputName]: tensor })
      const yawTensor = result[outputNames[0]] || Object.values(result)[0]
      const pitchTensor = result[outputNames[1]] || Object.values(result)[1]

      if (yawTensor?.data && pitchTensor?.data) {
        latestOnnxGazeRef.current = decodeOnnxGaze(yawTensor.data, pitchTensor.data)
      }
    } catch {
      latestOnnxGazeRef.current = null
    } finally {
      onnxRunningRef.current = false
    }
  }, [])

  const updateWebGazerPoint = useCallback((data) => {
    const normalizedPoint = normalizeGazePoint(data)
    if (!normalizedPoint) return

    const viewportPoint = clampToViewport(normalizedPoint)
    lastPredictionAtRef.current = Date.now()
    latestWebGazerPointRef.current = {
      ...viewportPoint,
      timestamp: Date.now(),
      source: 'webgazer',
    }
    publishFusedPoint()
  }, [publishFusedPoint])

  const startPredictionLoop = useCallback((webgazer) => {
    stopPredictionLoop()

    const readPrediction = async () => {
      try {
        const lastPointAge =
          Date.now() - (latestWebGazerPointRef.current?.timestamp || 0)

        if (lastPointAge > 90) {
          const prediction = await webgazer.getCurrentPrediction?.()
          updateWebGazerPoint(prediction)
        }
      } catch {
        // WebGazer가 보정 전 null/오류를 낼 수 있어서 다음 frame에서 다시 읽는다.
      } finally {
        predictionFrameRef.current = window.requestAnimationFrame(readPrediction)
      }
    }

    predictionFrameRef.current = window.requestAnimationFrame(readPrediction)
  }, [stopPredictionLoop, updateWebGazerPoint])

  const startMediaPipeLoop = useCallback((faceLandmarker) => {
    stopMediaPipeLoop()

    if (!ENABLE_AI_ASSIST || !faceLandmarker) return

    const readFaceLandmarks = () => {
      const video = getWebGazerVideoElement()
      const now = Date.now()

      try {
        if (
          video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          now - lastMediaPipeRunAtRef.current >= MEDIAPIPE_FRAME_INTERVAL_MS
        ) {
          lastMediaPipeRunAtRef.current = now
          const result = faceLandmarker.detectForVideo(video, performance.now())
          const landmarks = result.faceLandmarks?.[0]
          const faceMatrix = result.facialTransformationMatrixes?.[0]

          faceDetectedRef.current = Boolean(landmarks)

          if (landmarks) {
            const features = buildFeatureVector(
              landmarks,
              latestWebGazerPointRef.current,
              latestOnnxGazeRef.current,
              faceMatrix,
            )

            latestFeatureVectorRef.current = features
            if (features) {
              featureHistoryRef.current = [
                ...featureHistoryRef.current,
                {
                  features,
                  timestamp: Date.now(),
                },
              ].slice(-FEATURE_HISTORY_LIMIT)
            }

            if (features && calibrationModelRef.current?.isReliable) {
              latestMediaPipePointRef.current = {
                ...predictFromModel(calibrationModelRef.current, features),
                source: 'mediapipe',
              }
            } else {
              latestMediaPipePointRef.current = null
            }

            runOnnxGaze(video, landmarks)
            publishFusedPoint()
          }
        }
      } catch {
        faceDetectedRef.current = false
      } finally {
        mediaPipeFrameRef.current = window.requestAnimationFrame(readFaceLandmarks)
      }
    }

    mediaPipeFrameRef.current = window.requestAnimationFrame(readFaceLandmarks)
  }, [publishFusedPoint, runOnnxGaze, stopMediaPipeLoop])

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
      latestWebGazerPointRef.current = null
      latestMediaPipePointRef.current = null
      latestOnnxGazeRef.current = null
      latestFeatureVectorRef.current = null
      featureHistoryRef.current = []
      fusedHistoryRef.current = []
      oneEuroFilterRef.current = null

      startPreviewPinning()

      // gaze listener는 viewport 기준 x/y 좌표만 앱 상태로 전달한다.
      webgazer.setGazeListener((data) => {
        updateWebGazerPoint(data)
      })

      webgazer
        .showVideoPreview(true)
        .showPredictionPoints(false)
        .showFaceOverlay(false)
        .showFaceFeedbackBox(false)

      await webgazer.begin()
      const faceLandmarker = ENABLE_AI_ASSIST
        ? await loadFaceLandmarker()
        : null

      startPreviewPinning()
      startPredictionLoop(webgazer)
      if (faceLandmarker) {
        startMediaPipeLoop(faceLandmarker)
        if (ENABLE_ONNX_GAZE) {
          loadOnnxGazeModel().catch(() => {})
        }
      }
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
    loadFaceLandmarker,
    loadOnnxGazeModel,
    loadWebGazer,
    startMediaPipeLoop,
    startPredictionLoop,
    startPreviewPinning,
    updateWebGazerPoint,
  ])

  const recordCalibrationPoint = useCallback((x, y, options = {}) => {
    const webgazer = webgazerRef.current
    webgazer?.recordScreenPosition?.(x, y, 'click')

    if (!ENABLE_AI_ASSIST) {
      setTrackerInfo({
        engine: getTrackerEngineName(null, ''),
        calibrationSamples: calibrationSamplesRef.current.length,
        isHybridCalibrated: false,
        isHybridReliable: false,
        calibrationModelName: '',
        calibrationErrorPx: null,
        mediaPipeReady: false,
        onnxReady: false,
        faceDetected: false,
      })
      return true
    }

    const featureVectors = getCalibrationFeatureVectors(
      featureHistoryRef.current,
      Date.now(),
      options.pointShownAt || 0,
    )

    if (featureVectors.length === 0) {
      setTrackerInfo({
        engine: getTrackerEngineName(
          calibrationModelRef.current,
          onnxModelNameRef.current,
        ),
        calibrationSamples: calibrationSamplesRef.current.length,
        isHybridCalibrated: Boolean(calibrationModelRef.current),
        isHybridReliable: Boolean(calibrationModelRef.current?.isReliable),
        calibrationModelName: calibrationModelRef.current?.candidateName || '',
        calibrationErrorPx: calibrationModelRef.current
          ? {
              median: calibrationModelRef.current.validationMedianPx,
              p90: calibrationModelRef.current.validationP90Px,
            }
          : null,
        mediaPipeReady: Boolean(faceLandmarkerRef.current),
        onnxReady: Boolean(onnxSessionRef.current),
        faceDetected: faceDetectedRef.current,
      })
      return true
    }

    const targetX = x / window.innerWidth
    const targetY = y / window.innerHeight
    const targetKey = `${Math.round(targetX * 1000)}:${Math.round(targetY * 1000)}`
    const nextSamples = featureVectors.map((features) => ({
      features,
      targetX,
      targetY,
      targetKey,
    }))

    calibrationSamplesRef.current = [
      ...calibrationSamplesRef.current,
      ...nextSamples,
    ].slice(-MAX_CALIBRATION_SAMPLES)

    const nextModel = fitCalibrationModel(calibrationSamplesRef.current)
    if (nextModel) {
      calibrationModelRef.current = nextModel
      latestMediaPipePointRef.current = null
      fusedHistoryRef.current = []
      oneEuroFilterRef.current = null
    }

    setTrackerInfo({
      engine: getTrackerEngineName(
        calibrationModelRef.current,
        onnxModelNameRef.current,
      ),
      calibrationSamples: calibrationSamplesRef.current.length,
      isHybridCalibrated: Boolean(calibrationModelRef.current),
      isHybridReliable: Boolean(calibrationModelRef.current?.isReliable),
      calibrationModelName: calibrationModelRef.current?.candidateName || '',
      calibrationErrorPx: calibrationModelRef.current
        ? {
            median: calibrationModelRef.current.validationMedianPx,
            p90: calibrationModelRef.current.validationP90Px,
          }
        : null,
      mediaPipeReady: Boolean(faceLandmarkerRef.current),
      onnxReady: Boolean(onnxSessionRef.current),
      faceDetected: faceDetectedRef.current,
    })

    return true
  }, [])

  const resetCalibration = useCallback(() => {
    calibrationSamplesRef.current = []
    calibrationModelRef.current = null
    latestMediaPipePointRef.current = null
    featureHistoryRef.current = []
    fusedHistoryRef.current = []
    oneEuroFilterRef.current = null
    setTrackerInfo((info) => ({
      ...info,
      engine: getTrackerEngineName(null, onnxModelNameRef.current),
      calibrationSamples: 0,
      isHybridCalibrated: false,
      isHybridReliable: false,
      calibrationModelName: '',
      calibrationErrorPx: null,
    }))
  }, [])

  const stop = useCallback(() => {
    const webgazer = webgazerRef.current

    try {
      webgazer?.clearGazeListener?.()
      webgazer?.pause?.()
    } finally {
      stopPredictionLoop()
      stopMediaPipeLoop()
      stopPreviewPinning()
      latestWebGazerPointRef.current = null
      latestMediaPipePointRef.current = null
      latestOnnxGazeRef.current = null
      latestFeatureVectorRef.current = null
      featureHistoryRef.current = []
      fusedHistoryRef.current = []
      oneEuroFilterRef.current = null
      setIsTracking(false)
      setStatus('paused')
    }
  }, [stopMediaPipeLoop, stopPredictionLoop, stopPreviewPinning])

  useEffect(() => {
    return () => {
      stopPredictionLoop()
      stopMediaPipeLoop()
      stopPreviewPinning()
      const webgazer = webgazerRef.current
      if (webgazer?.end) webgazer.end()
      faceLandmarkerRef.current?.close?.()
    }
  }, [stopMediaPipeLoop, stopPredictionLoop, stopPreviewPinning])

  return {
    gazePoint,
    isTracking,
    status,
    error,
    trackerInfo,
    recordCalibrationPoint,
    resetCalibration,
    start,
    stop,
  }
}
