import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'

export default function QuickBooksSettings() {
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

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>📊 QuickBooks Online</div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          Push invoices to QuickBooks as drafts. Payments auto-sync back into Operix.
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
