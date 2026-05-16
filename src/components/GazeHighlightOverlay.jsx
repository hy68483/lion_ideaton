export default function GazeHighlightOverlay({
  currentTarget,
  highlightedTexts,
  focusEffect = 'mosaic',
}) {
  const getBoxStyle = (rect, padding = 0) => ({
    left: Math.max(0, rect.left - padding),
    top: Math.max(0, rect.top - padding),
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  })

  return (
    <div className="gaze-highlight-overlay" aria-hidden="true">
      {highlightedTexts.map((rect) => (
        <div
          key={rect.id}
          className="gaze-highlight-box gaze-highlight-box-done"
          style={getBoxStyle(rect)}
        />
      ))}

      {currentTarget && (
        <div
          className={`gaze-highlight-box gaze-highlight-box-current gaze-highlight-box-current-${focusEffect}`}
          style={getBoxStyle(currentTarget, focusEffect === 'highlight' ? 0 : 7)}
        />
      )}
    </div>
  )
}
