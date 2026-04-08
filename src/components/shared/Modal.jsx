export default function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-handle" />
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  )
}
