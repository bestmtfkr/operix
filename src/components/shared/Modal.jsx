import { useEffect } from 'react'

export default function Modal({ title, onClose, children }) {
  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        {title && <div className="modal-title">{title}</div>}
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  )
}
