import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'

export default function QuickBooksSettings({ settings, updateSettings, onSaveSettings }) {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [loading, setLoading] = useState(true)
  const [tokens, setTokens] = useState(null)
  const [qboSettings, setQboSettings] = useState({})
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [taxCodes, setTaxCodes] = useState([])
  const [loadingTaxCodes, setLoadingTaxCodes] = useState(false)
  const [savingMapping, setSavingMapping] = useState(false)
  const [savingBilling, setSavingBilling] = useState(false)

  useEffect(() => { if (companyId) load() }, [companyId])

  // Listen for OAuth popup callback
  useEffect(() => {
    function onMessage(e) {
      if (e.data?.type === 'qbo-connected') {
        showToast('QuickBooks connected: ' + (e.data.environment || 'sandbox'))
        load()
      } else if (e.data?.type === 'qbo-error') {
        showToast('QuickBooks error: ' + (e.data.error || 'unknown'))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [companyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('companies')
      .select('qbo_tokens, qbo_settings')
      .eq('id', companyId)
      .single()
    setTokens(data?.qbo_tokens || null)
    setQboSettings(data?.qbo_settings || {})
    setLoading(false)
  }

  function connect() {
    const w = window.open(
      `/api/qbo/connect?company_id=${companyId}`,
      '_blank',
      'width=600,height=720,left=200,top=80'
    )
    if (!w) showToast('Popup blocked — allow popups for this site')
  }

  async function disconnect() {
    if (!confirm('Disconnect QuickBooks? Existing customer/invoice links remain but pushes will stop.')) return
    await supabase.from('companies').update({ qbo_tokens: null }).eq('id', companyId)
    showToast('QuickBooks disconnected')
    load()
  }

  async function importCustomers(save = true) {
    setImporting(true)
    setImportResult(null)
    try {
      const res = await fetch('/.netlify/functions/qbo-import-customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, save })
      })
      const data = await res.json()
      if (data.error) {
        showToast('Import failed: ' + data.error)
      } else {
        setImportResult(data)
        showToast(`${data.created} created, ${data.linked} linked, ${data.saved} updated`)
        load()
      }
    } catch (err) {
      showToast('Import error: ' + err.message)
    }
    setImporting(false)
  }

  async function loadTaxCodes() {
    setLoadingTaxCodes(true)
    try {
      const res = await fetch('/.netlify/functions/qbo-tax-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId })
      })
      const data = await res.json()
      if (data.error) {
        showToast('Failed: ' + data.error)
      } else {
        setTaxCodes(data.tax_codes || [])
      }
    } catch (err) {
      showToast('Error: ' + err.message)
    }
    setLoadingTaxCodes(false)
  }

  async function saveTaxMapping(taxCode) {
    setSavingMapping(true)
    const updated = {
      ...qboSettings,
      tax_code_id: taxCode.id,
      tax_code_label: taxCode.name
    }
    await supabase.from('companies').update({ qbo_settings: updated }).eq('id', companyId)
    setQboSettings(updated)
    setSavingMapping(false)
    showToast('Tax mapping saved')
  }

  async function saveAutoSend(value) {
    const updated = { ...qboSettings, auto_send: value }
    await supabase.from('companies').update({ qbo_settings: updated }).eq('id', companyId)
    setQboSettings(updated)
  }

  if (loading) {
    return <div style={{ padding: 16 }}><div className="spinner" /></div>
  }

  const isConnected = !!tokens?.access_token

  async function saveBilling() {
    if (!onSaveSettings) return
    setSavingBilling(true)
    await onSaveSettings()
    setSavingBilling(false)
    showToast('Billing settings saved')
  }

  return (
    <div id="billing-settings" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>💰 Billing & QuickBooks</div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          Taxes, invoice numbering, and QuickBooks Online sync.
        </div>
      </div>

      {/* TAX SETTINGS */}
      {settings && updateSettings && <>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Default Taxes
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
          Based on your company province. Individual invoices can override per-job.
        </div>
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

        {/* INVOICE NUMBERING + TERMS */}
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 20, marginBottom: 10 }}>
          Invoice Numbering & Terms
        </div>
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

        <button
          className="btn btn-primary btn-full"
          style={{ marginTop: 12, marginBottom: 24 }}
          onClick={saveBilling}
          disabled={savingBilling}
        >
          {savingBilling ? 'Saving...' : 'Save billing settings'}
        </button>
      </>}

      {/* QBO SECTION */}
      <div style={{ marginTop: 8, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>📊 QuickBooks Online</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            Push invoices to QuickBooks as drafts. Payments auto-sync back.
          </div>
        </div>
      </div>

      {!isConnected && (
        <div style={{ padding: 16, background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
            Connect your QuickBooks Online account to start pushing invoices and importing customers.
          </div>
          <button
            onClick={connect}
            className="btn btn-primary"
            style={{ padding: '12px 20px', fontWeight: 700 }}
          >
            🔗 Connect QuickBooks
          </button>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 10 }}>
            Environment: <strong>{(import.meta.env?.VITE_INTUIT_ENV) || 'sandbox'}</strong> • Will use Operix's app credentials
          </div>
        </div>
      )}

      {isConnected && <>
        <div style={{ padding: 14, background: 'rgba(0,212,160,0.06)', borderRadius: 12, border: '1px solid rgba(0,212,160,0.2)', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>✓</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>
                Connected ({qboSettings.environment || 'sandbox'})
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                Realm ID: {tokens.realm_id} • Connected {new Date(tokens.connected_at).toLocaleDateString('en-CA')}
              </div>
            </div>
            <button onClick={disconnect} style={{ padding: '6px 12px', fontSize: 11, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)', borderRadius: 6, cursor: 'pointer', fontFamily: 'DM Sans' }}>
              Disconnect
            </button>
          </div>
        </div>

        {/* Customer import */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Customer Sync</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
            Pulls all active customers from QuickBooks. Existing Operix clients are matched by email or name and linked. New customers are created.
          </div>
          <button
            onClick={() => importCustomers(true)}
            disabled={importing}
            className="btn btn-secondary"
            style={{ padding: '10px 16px', fontWeight: 600 }}
          >
            {importing ? '⏳ Importing...' : '📥 Import / Sync Customers'}
          </button>
          {qboSettings.last_customer_sync_at && (
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>
              Last synced: {new Date(qboSettings.last_customer_sync_at).toLocaleString('en-CA')}
            </div>
          )}
          {importResult && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--bg2)', borderRadius: 8, fontSize: 12, color: 'var(--text2)' }}>
              ✓ {importResult.total} total — {importResult.created} created, {importResult.linked} linked to existing, {importResult.saved} updated
            </div>
          )}
        </div>

        {/* Tax code mapping */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Tax Code Mapping</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
            Select which QuickBooks tax code your invoices should use. This ensures totals match between Operix and QBO.
          </div>
          {qboSettings.tax_code_id && (
            <div style={{ padding: 10, background: 'var(--bg2)', borderRadius: 8, fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
              Current: <strong>{qboSettings.tax_code_label}</strong> (ID {qboSettings.tax_code_id})
            </div>
          )}
          {taxCodes.length === 0 && (
            <button
              onClick={loadTaxCodes}
              disabled={loadingTaxCodes}
              className="btn btn-secondary"
              style={{ padding: '8px 14px', fontSize: 12 }}
            >
              {loadingTaxCodes ? '⏳ Loading...' : 'Load tax codes from QBO'}
            </button>
          )}
          {taxCodes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
              {taxCodes.map(tc => (
                <button
                  key={tc.id}
                  onClick={() => saveTaxMapping(tc)}
                  disabled={savingMapping}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: 6,
                    background: qboSettings.tax_code_id === tc.id ? 'rgba(0,212,160,0.1)' : 'transparent',
                    border: qboSettings.tax_code_id === tc.id ? '1px solid rgba(0,212,160,0.3)' : '1px solid var(--border)',
                    color: 'var(--text2)', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans', textAlign: 'left'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{tc.name}</div>
                    {tc.description && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{tc.description}</div>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {tc.taxable ? `${(tc.rate).toFixed(2)}%` : 'Exempt'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Auto-send toggle */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Push behavior</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--bg2)', borderRadius: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={qboSettings.auto_send || false}
              onChange={e => saveAutoSend(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Auto-send invoice email from QuickBooks</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                When enabled, pushed invoices are immediately emailed by QBO using the billing email. When disabled, invoices land as drafts in QBO for review.
              </div>
            </div>
          </label>
        </div>
      </>}
    </div>
  )
}
