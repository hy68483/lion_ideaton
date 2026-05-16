import { forwardRef } from 'react'
import { Document, Page } from 'react-pdf'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'

const PdfViewer = forwardRef(function PdfViewer(
  {
    file,
    pageNumber,
    numPages,
    scale,
    onLoadSuccess,
    onRenderSuccess,
    onPageChange,
    onScaleChange,
  },
  ref,
) {
  return (
    <section className="viewer-shell">
      <div className="viewer-toolbar">
        <div className="page-controls">
          <button
            type="button"
            aria-label="이전 페이지"
            onClick={() => onPageChange(Math.max(1, pageNumber - 1))}
            disabled={pageNumber <= 1}
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            {pageNumber} / {numPages || '-'}
          </span>
          <button
            type="button"
            aria-label="다음 페이지"
            onClick={() => onPageChange(Math.min(numPages || 1, pageNumber + 1))}
            disabled={!numPages || pageNumber >= numPages}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="page-controls">
          <button
            type="button"
            aria-label="축소"
            onClick={() => onScaleChange(Math.max(0.75, scale - 0.1))}
          >
            <ZoomOut size={18} />
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            type="button"
            aria-label="확대"
            onClick={() => onScaleChange(Math.min(2.4, scale + 0.1))}
          >
            <ZoomIn size={18} />
          </button>
        </div>
      </div>

      <div className="pdf-stage" ref={ref}>
        {file ? (
          <Document
            file={file}
            onLoadSuccess={onLoadSuccess}
            loading={<div className="pdf-message">PDF를 불러오는 중입니다.</div>}
            error={<div className="pdf-message">PDF를 렌더링할 수 없습니다.</div>}
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer
              renderAnnotationLayer
              onRenderTextLayerSuccess={onRenderSuccess}
              onRenderSuccess={onRenderSuccess}
            />
          </Document>
        ) : (
          <div className="empty-pdf">
            <strong>PDF를 업로드해 주세요.</strong>
            <span>업로드 후 text layer 좌표가 자동으로 추출됩니다.</span>
          </div>
        )}
      </div>
    </section>
  )
})

export default PdfViewer
