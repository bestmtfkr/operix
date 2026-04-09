import { useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from './Toast'

export default function FileUpload({ jobId, onUpload }) {
  const { companyId, profile } = useAuth()
  const showToast = useToast()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const [uploadType, setUploadType] = useState('photo') // photo, document, receipt

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10MB)'); return }

    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${companyId}/${jobId}/${Date.now()}.${ext}`

    const { error } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type })
    if (error) { showToast('Upload failed'); setUploading(false); return }

    const isImage = file.type.startsWith('image/')
    const activityType = uploadType === 'receipt' ? 'document' : (isImage ? 'photo' : 'document')

    await supabase.from('job_activity').insert({
      company_id: companyId, job_id: jobId, author_id: profile?.id,
      type: activityType,
      content: uploadType === 'receipt' ? `🧾 Receipt: ${file.name}` : file.name,
      file_url: path, file_name: file.name,
      file_type: uploadType,
      metadata: { file_type: file.type, file_size: file.size, category: uploadType }
    })

    showToast(uploadType === 'receipt' ? '🧾 Receipt uploaded' : isImage ? 'Photo uploaded' : 'Document uploaded')
    setUploading(false)
    fileRef.current.value = ''
    if (onUpload) onUpload()
  }

  function triggerUpload(type) {
    setUploadType(type)
    if (type === 'receipt') {
      fileRef.current.accept = 'image/*,.pdf'
      // Try camera first on mobile
      fileRef.current.capture = 'environment'
    } else if (type === 'photo') {
      fileRef.current.accept = 'image/*'
      fileRef.current.capture = 'environment'
    } else {
      fileRef.current.accept = '.pdf,.doc,.docx,.xls,.xlsx'
      fileRef.current.removeAttribute('capture')
    }
    fileRef.current.click()
  }

  return (
    <div>
      <input ref={fileRef} type="file" onChange={handleUpload} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-secondary" style={{ flex: 1, fontSize: 12, padding: '10px 8px' }}
          onClick={() => triggerUpload('photo')} disabled={uploading}>
          {uploading && uploadType === 'photo' ? '⏳' : '📷'} Photo
        </button>
        <button onClick={() => triggerUpload('receipt')} disabled={uploading} style={{
          flex: 1, fontSize: 12, padding: '10px 8px', borderRadius: 12, fontWeight: 700,
          background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)',
          color: 'var(--yellow)', cursor: 'pointer', fontFamily: 'DM Sans'
        }}>
          {uploading && uploadType === 'receipt' ? '⏳' : '🧾'} Receipt
        </button>
        <button className="btn btn-secondary" style={{ flex: 1, fontSize: 12, padding: '10px 8px' }}
          onClick={() => triggerUpload('document')} disabled={uploading}>
          {uploading && uploadType === 'document' ? '⏳' : '📎'} Doc
        </button>
      </div>
    </div>
  )
}
