import { useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Simple cache — data persists across tab switches
const cache = {}
const CACHE_TTL = 60000 // 1 minute before refetch

export function useSupabaseQuery(key, queryFn, deps = []) {
  const [data, setData] = useState(cache[key]?.data || null)
  const [loading, setLoading] = useState(!cache[key]?.data)
  const [error, setError] = useState(null)
  const fetchedRef = useRef(false)

  const fetch = useCallback(async (force = false) => {
    // Use cache if fresh
    if (!force && cache[key] && Date.now() - cache[key].time < CACHE_TTL) {
      setData(cache[key].data)
      setLoading(false)
      return cache[key].data
    }

    setLoading(!cache[key]?.data) // Only show loading if no cached data
    try {
      const result = await queryFn()
      cache[key] = { data: result, time: Date.now() }
      setData(result)
      setError(null)
      return result
    } catch (err) {
      setError(err)
      return null
    } finally {
      setLoading(false)
    }
  }, [key, ...deps])

  // Auto-fetch on mount if not fetched
  if (!fetchedRef.current && deps.every(d => d)) {
    fetchedRef.current = true
    fetch()
  }

  const refetch = useCallback(() => fetch(true), [fetch])
  const invalidate = useCallback(() => { delete cache[key] }, [key])

  return { data, loading, error, refetch, invalidate }
}

// Invalidate all cache (used after major changes)
export function invalidateAll() {
  Object.keys(cache).forEach(k => delete cache[k])
}

// Preload common data
export function preloadData(companyId) {
  if (!companyId) return

  // Preload clients
  if (!cache['clients-' + companyId]) {
    supabase.from('clients').select('id, name, contact_name, contact_email, type')
      .eq('company_id', companyId).is('archived_at', null).order('name')
      .then(({ data }) => {
        if (data) cache['clients-' + companyId] = { data, time: Date.now() }
      })
  }

  // Preload jobs
  if (!cache['jobs-' + companyId]) {
    supabase.from('jobs').select('id, name, job_number, stage, client_id, estimated_value, clients(name)')
      .eq('company_id', companyId).is('archived_at', null).order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) cache['jobs-' + companyId] = { data, time: Date.now() }
      })
  }
}
