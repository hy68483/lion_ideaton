import GazeDot from './GazeDot.jsx'

export default function GazeTracker({ gazePoint, isTracking }) {
  return <GazeDot point={gazePoint} visible={isTracking} />
}
