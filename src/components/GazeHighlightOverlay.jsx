export default function GazeHighlightOverlay({
  currentTarget,
  highlightedTexts,
}) {
  return (
    <div className="gaze-highlight-overlay" aria-hidden="true">
      {highlightedTexts.map((rect) => (
        <div
          key={rect.id}
          className="gaze-highlight-box gaze-highlight-box-done"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}

      {currentTarget && (
        <div
          className="gaze-highlight-box gaze-highlight-box-current"
          style={{
            left: currentTarget.left,
            top: currentTarget.top,
            width: currentTarget.width,
            height: currentTarget.height,
          }}
        />
      )}
    </div>
  )
}
