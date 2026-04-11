import { useEffect, useRef } from 'react'

export default function Modal({ title, onClose, children }) {
  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Only close if the interaction *started* on the overlay itself.
  // Without this, selecting text inside the modal and dragging the
  // mouse past the edge on release fires a click on the overlay and
  // closes the modal mid-selection.
  const downOnOverlay = useRef(false)

  function handleMouseDown(e) {
    downOnOverlay.current = e.target === e.currentTarget
  }

  function handleMouseUp(e) {
    if (downOnOverlay.current && e.target === e.currentTarget) {
      onClose()
    }
    downOnOverlay.current = false
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
    >
      <div className="modal" onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
        <div className="modal-handle" />
        {title && <div className="modal-title">{title}</div>}
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  )
}
