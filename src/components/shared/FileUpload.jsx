import { useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from './Toast'

export default function FileUpload({ jobId, onUpload }) {
  const { companyId, profile } = useAuth()
  const showToast = useToast()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 10 * 1024 * 1024) {
      showToast('File too large (max 10MB)')
      return
    }

    setUploading(true)

    // Upload to Supabase Storage
    const ext = file.name.split('.').pop()
    const path = `${companyId}/${jobId}/${Date.now()}.${ext}`

    const { data, error } = await supabase.storage
      .from('documents')
      .upload(path, file, { contentType: file.type })

    if (error) {
      showToast('Upload failed')
      console.error(error)
      setUploading(false)
      return
    }

    // Store the path (not a public URL — we'll generate signed URLs when viewing)
    const isImage = file.type.startsWith('image/')
    await supabase.from('job_activity').insert({
      company_id: companyId,
      job_id: jobId,
      author_id: profile?.id,
      type: isImage ? 'photo' : 'document',
      content: file.name,
      file_url: path,
      file_name: file.name,
      metadata: { file_type: file.type, file_size: file.size }
    })

    showToast(isImage ? 'Photo uploaded' : 'Document uploaded')
    setUploading(false)
    fileRef.current.value = ''
    if (onUpload) onUpload()
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
        onChange={handleUpload}
        style={{ display: 'none' }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn-secondary"
          style={{ flex: 1, fontSize: 13 }}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? '⏳ Uploading...' : '📷 Photo'}
        </button>
        <button
          className="btn btn-secondary"
          style={{ flex: 1, fontSize: 13 }}
          onClick={() => {
            fileRef.current.accept = '.pdf,.doc,.docx,.xls,.xlsx'
            fileRef.current?.click()
            setTimeout(() => { fileRef.current.accept = "image/*,.pdf,.doc,.docx,.xls,.xlsx" }, 100)
          }}
          disabled={uploading}
        >
          {uploading ? '⏳ Uploading...' : '📎 Document'}
        </button>
      </div>
    </div>
  )
}
