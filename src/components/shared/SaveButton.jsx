import { useState } from 'react'

export default function SaveButton({ onClick, children, className = 'btn btn-primary btn-full', ...props }) {
  const [saving, setSaving] = useState(false)

  async function handleClick() {
    if (saving) return
    setSaving(true)
    try {
      await onClick()
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      className={className}
      onClick={handleClick}
      disabled={saving}
      {...props}
    >
      {saving ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
          <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          Saving...
        </span>
      ) : children}
    </button>
  )
}
