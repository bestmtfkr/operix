import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TAX_PRESETS } from '../../lib/constants'

export default function OnboardingScreen({ user, onComplete }) {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    company_name: '',
    full_name: user?.user_metadata?.full_name || user?.email?.split('@')[0] || '',
    industry: 'facility_management',
    country: 'CA',
    province_state: '',
    city: '',
    phone: '',
    team_size: '1-10'
  })

  function updateForm(f, v) { setForm(prev => ({ ...prev, [f]: v })) }

  async function finish() {
    if (!form.company_name.trim()) { setError('Company name is required'); return }
    if (!form.full_name.trim()) { setError('Your name is required'); return }

    setSaving(true)
    setError('')

    // Get tax preset
    const taxPreset = TAX_PRESETS[form.province_state] || TAX_PRESETS['ON']

    // Create company
    const { data: company, error: compErr } = await supabase.from('companies').insert({
      name: form.company_name.trim(),
      industry: form.industry,
      country: form.country,
      province_state: form.province_state,
      city: form.city.trim(),
      phone: form.phone.trim(),
      plan: 'trial',
      settings: {
        tax_mode: taxPreset?.mode || 'hst',
        tax_label_1: taxPreset?.label1 || 'HST',
        tax_rate_1: taxPreset?.rate1 || 0.13,
        tax_label_2: taxPreset?.label2 || null,
        tax_rate_2: taxPreset?.rate2 || null,
        tax_registration_number: null,
        invoice_prefix: 'INV',
        invoice_next_number: 1001,
        quote_prefix: 'QT',
        quote_next_number: 1001,
        default_payment_terms_days: 30,
        currency: form.country === 'US' ? 'USD' : 'CAD',
        overtime_threshold_hours: 8.0,
        overtime_multiplier: 1.5
      }
    }).select().single()

    if (compErr || !company) {
      setError('Error creating company. Please try again.')
      setSaving(false)
      console.error(compErr)
      return
    }

    // Create profile
    const { error: profErr } = await supabase.from('profiles').insert({
      id: user.id,
      company_id: company.id,
      full_name: form.full_name.trim(),
      email: user.email,
      role: 'owner'
    })

    if (profErr) {
      setError('Error creating profile. Please try again.')
      setSaving(false)
      console.error(profErr)
      return
    }

    onComplete()
  }

  const industries = [
    { value: 'restoration', label: 'Restoration (Water/Fire/Mold)' },
    { value: 'facility_management', label: 'Facility Management' },
    { value: 'commercial_cleaning', label: 'Commercial Cleaning' },
    { value: 'hvac', label: 'HVAC' },
    { value: 'plumbing', label: 'Plumbing' },
    { value: 'electrical', label: 'Electrical' },
    { value: 'general_contractor', label: 'General Contractor' },
    { value: 'other', label: 'Other' }
  ]

  const provinces = [
    { value: 'ON', label: 'Ontario' }, { value: 'QC', label: 'Quebec' },
    { value: 'BC', label: 'British Columbia' }, { value: 'AB', label: 'Alberta' },
    { value: 'MB', label: 'Manitoba' }, { value: 'SK', label: 'Saskatchewan' },
    { value: 'NS', label: 'Nova Scotia' }, { value: 'NB', label: 'New Brunswick' },
    { value: 'NL', label: 'Newfoundland' }, { value: 'PE', label: 'Prince Edward Island' },
  ]

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 28,
      background: 'radial-gradient(ellipse at 50% 0%, rgba(0,212,160,0.06) 0%, transparent 60%)'
    }}>
      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          width: 60, height: 60, borderRadius: 18, margin: '0 auto 14px',
          background: 'linear-gradient(135deg, rgba(0,212,160,0.15), rgba(0,153,255,0.1))',
          border: '1px solid rgba(0,212,160,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            width: 24, height: 24,
            background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
            transform: 'rotate(45deg)', borderRadius: 5
          }} />
        </div>
        <div style={{
          fontSize: 22, fontWeight: 800, letterSpacing: 5,
          background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
        }}>OPERIX</div>
      </div>

      <div style={{
        width: '100%', maxWidth: 440,
        background: 'linear-gradient(135deg, var(--card), var(--card2))',
        border: '1px solid var(--border2)', borderRadius: 24, padding: 32,
        boxShadow: '0 24px 64px rgba(0,0,0,0.4)'
      }}>
        {/* Progress */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {[1, 2].map(s => (
            <div key={s} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: s <= step ? 'var(--primary)' : 'var(--border2)'
            }} />
          ))}
        </div>

        {step === 1 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Welcome to Operix</h2>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 24, lineHeight: 1.5 }}>
              Let's set up your company. This takes 30 seconds.
            </p>

            <div className="form-field">
              <label className="form-label">Your Name *</label>
              <input className="form-input" placeholder="Full name"
                value={form.full_name} onChange={e => updateForm('full_name', e.target.value)} />
            </div>

            <div className="form-field">
              <label className="form-label">Company Name *</label>
              <input className="form-input" placeholder="e.g. Summit Restoration Inc."
                value={form.company_name} onChange={e => updateForm('company_name', e.target.value)} />
            </div>

            <div className="form-field">
              <label className="form-label">Industry</label>
              <select className="form-input" value={form.industry} onChange={e => updateForm('industry', e.target.value)}>
                {industries.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>

            <button className="btn btn-primary btn-full" onClick={() => {
              if (!form.full_name.trim() || !form.company_name.trim()) { setError('Please fill in your name and company'); return }
              setError(''); setStep(2)
            }}>
              Continue →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Location & Contact</h2>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 24, lineHeight: 1.5 }}>
              We'll set up your tax rates automatically based on your province.
            </p>

            <div className="form-row">
              <div className="form-field">
                <label className="form-label">Country</label>
                <select className="form-input" value={form.country} onChange={e => updateForm('country', e.target.value)}>
                  <option value="CA">Canada</option>
                  <option value="US">United States</option>
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Province / State</label>
                {form.country === 'CA' ? (
                  <select className="form-input" value={form.province_state} onChange={e => updateForm('province_state', e.target.value)}>
                    <option value="">Select...</option>
                    {provinces.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                ) : (
                  <input className="form-input" placeholder="e.g. NY, TX" value={form.province_state} onChange={e => updateForm('province_state', e.target.value.toUpperCase())} />
                )}
              </div>
            </div>

            <div className="form-row">
              <div className="form-field">
                <label className="form-label">City</label>
                <input className="form-input" placeholder="City"
                  value={form.city} onChange={e => updateForm('city', e.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label">Phone</label>
                <input className="form-input" placeholder="(514) 000-0000"
                  value={form.phone} onChange={e => updateForm('phone', e.target.value)} />
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">Team Size</label>
              <select className="form-input" value={form.team_size} onChange={e => updateForm('team_size', e.target.value)}>
                <option value="1-10">1–10 workers</option>
                <option value="11-30">11–30 workers</option>
                <option value="31-60">31–60 workers</option>
                <option value="61+">61+ workers</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary" style={{ flex: 0.4 }} onClick={() => setStep(1)}>← Back</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={finish} disabled={saving}>
                {saving ? 'Setting up...' : 'Launch Operix 🚀'}
              </button>
            </div>
          </>
        )}

        {error && (
          <div style={{
            color: 'var(--red)', fontSize: 13, textAlign: 'center', marginTop: 14,
            padding: '10px 14px', background: 'rgba(255,59,92,0.08)', borderRadius: 10,
            border: '1px solid rgba(255,59,92,0.2)'
          }}>{error}</div>
        )}
      </div>
    </div>
  )
}
