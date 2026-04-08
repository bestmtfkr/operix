import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import { TAX_PRESETS } from '../../lib/constants'

export default function CompanySettings({ onNavigate }) {
  const { companyId, profile, signOut } = useAuth()
  const showToast = useToast()
  const [company, setCompany] = useState(null)
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name: '', phone: '', email: '', website: '',
    address_line1: '', city: '', province_state: '', postal_zip: '', country: 'CA'
  })

  useEffect(() => { if (companyId) loadCompany() }, [companyId])

  async function loadCompany() {
    const { data } = await supabase.from('companies').select('*').eq('id', companyId).single()
    if (data) {
      setCompany(data)
      setSettings(data.settings || {})
      setForm({
        name: data.name || '', phone: data.phone || '', email: data.email || '',
        website: data.website || '', address_line1: data.address_line1 || '',
        city: data.city || '', province_state: data.province_state || '',
        postal_zip: data.postal_zip || '', country: data.country || 'CA'
      })
    }
    setLoading(false)
  }

  function updateForm(f, v) { setForm(prev => ({ ...prev, [f]: v })) }
  function updateSettings(f, v) { setSettings(prev => ({ ...prev, [f]: v })) }

  function applyTaxPreset(provinceCode) {
    const preset = TAX_PRESETS[provinceCode]
    if (!preset) return
    setSettings(prev => ({
      ...prev,
      tax_mode: preset.mode,
      tax_label_1: preset.label1,
      tax_rate_1: preset.rate1,
      tax_label_2: preset.label2,
      tax_rate_2: preset.rate2
    }))
    showToast('Tax preset applied for ' + provinceCode)
  }

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('companies').update({
      name: form.name, phone: form.phone, email: form.email, website: form.website,
      address_line1: form.address_line1, city: form.city,
      province_state: form.province_state, postal_zip: form.postal_zip,
      country: form.country, settings
    }).eq('id', companyId)

    setSaving(false)
    if (error) { showToast('Error saving settings'); console.error(error); return }
    showToast('Settings saved')
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      {/* Profile Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--card), var(--card2))',
        borderBottom: '1px solid var(--border)', padding: '24px 20px',
        display: 'flex', alignItems: 'center', gap: 18
      }}>
        <div style={{
          width: 68, height: 68, borderRadius: 20,
          background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, fontWeight: 800, color: '#000', flexShrink: 0
        }}>
          {(profile?.full_name || 'U').charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{profile?.full_name}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 3 }}>{profile?.email}</div>
          <span className="badge green" style={{ marginTop: 8, display: 'inline-block' }}>
            {(profile?.role || 'member').toUpperCase()}
          </span>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {/* Quick Links */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <div className="card" style={{ flex: 1, textAlign: 'center', padding: 14 }}
            onClick={() => onNavigate && onNavigate('reports')}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📊</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Reports</div>
          </div>
          <div className="card" style={{ flex: 1, textAlign: 'center', padding: 14, opacity: 0.4, cursor: 'default' }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📚</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>QuickBooks</div>
            <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>Coming soon</div>
          </div>
          <div className="card" style={{ flex: 1, textAlign: 'center', padding: 14, opacity: 0.4, cursor: 'default' }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📬</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Email</div>
            <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>Coming soon</div>
          </div>
        </div>

        {/* Company Info */}
        <div className="sec-hdr"><div className="sec-title">Company Info</div></div>

        <div className="form-field">
          <label className="form-label">Company Name</label>
          <input className="form-input" value={form.name} onChange={e => updateForm('name', e.target.value)} />
        </div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-label">Phone</label>
            <input className="form-input" value={form.phone} onChange={e => updateForm('phone', e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input className="form-input" value={form.email} onChange={e => updateForm('email', e.target.value)} />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">Address</label>
          <input className="form-input" value={form.address_line1} onChange={e => updateForm('address_line1', e.target.value)} />
        </div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-label">City</label>
            <input className="form-input" value={form.city} onChange={e => updateForm('city', e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Province/State</label>
            <input className="form-input" value={form.province_state}
              onChange={e => {
                updateForm('province_state', e.target.value.toUpperCase())
                if (TAX_PRESETS[e.target.value.toUpperCase()]) applyTaxPreset(e.target.value.toUpperCase())
              }} />
          </div>
        </div>

        {/* Tax Settings */}
        <div className="sec-hdr" style={{ marginTop: 24 }}><div className="sec-title">Tax Settings</div></div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-label">Tax 1 Label</label>
            <input className="form-input" placeholder="e.g. HST, GST"
              value={settings.tax_label_1 || ''} onChange={e => updateSettings('tax_label_1', e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Tax 1 Rate (%)</label>
            <input className="form-input" type="number" step="0.01"
              value={settings.tax_rate_1 ? (settings.tax_rate_1 * 100).toFixed(2) : ''}
              onChange={e => updateSettings('tax_rate_1', parseFloat(e.target.value) / 100 || 0)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-label">Tax 2 Label (optional)</label>
            <input className="form-input" placeholder="e.g. PST, QST"
              value={settings.tax_label_2 || ''} onChange={e => updateSettings('tax_label_2', e.target.value || null)} />
          </div>
          <div className="form-field">
            <label className="form-label">Tax 2 Rate (%)</label>
            <input className="form-input" type="number" step="0.01"
              value={settings.tax_rate_2 ? (settings.tax_rate_2 * 100).toFixed(3) : ''}
              onChange={e => updateSettings('tax_rate_2', parseFloat(e.target.value) / 100 || null)} />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">Tax Registration #</label>
          <input className="form-input" placeholder="GST/HST number"
            value={settings.tax_registration_number || ''} onChange={e => updateSettings('tax_registration_number', e.target.value)} />
        </div>

        {/* Invoice Settings */}
        <div className="sec-hdr" style={{ marginTop: 24 }}><div className="sec-title">Invoice Settings</div></div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-label">Invoice Prefix</label>
            <input className="form-input" placeholder="INV"
              value={settings.invoice_prefix || ''} onChange={e => updateSettings('invoice_prefix', e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Next Invoice #</label>
            <input className="form-input" type="number"
              value={settings.invoice_next_number || ''} onChange={e => updateSettings('invoice_next_number', parseInt(e.target.value) || 1001)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-label">Payment Terms (days)</label>
            <input className="form-input" type="number"
              value={settings.default_payment_terms_days || ''} onChange={e => updateSettings('default_payment_terms_days', parseInt(e.target.value) || 30)} />
          </div>
          <div className="form-field">
            <label className="form-label">Currency</label>
            <select className="form-input" value={settings.currency || 'CAD'} onChange={e => updateSettings('currency', e.target.value)}>
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        <button className="btn btn-primary btn-full" style={{ marginTop: 24 }} onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>

        <button className="btn btn-danger btn-full" style={{ marginTop: 16 }} onClick={signOut}>
          Sign Out
        </button>
      </div>
    </div>
  )
}
