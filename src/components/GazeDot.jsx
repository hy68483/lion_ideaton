export default function GazeDot({ point, visible }) {
  if (!visible || !point) return null

  return (
    <div
      className="gaze-dot"
      style={{
        transform: `translate(${point.x}px, ${point.y}px)`,
      }}
      aria-hidden="true"
    />
  )
}
