import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { JOB_STAGES, STAGE_LABELS, STAGE_COLORS } from '../lib/constants'

const DEFAULT_STAGES = JOB_STAGES.map(id => ({
  id, label: STAGE_LABELS[id], color: STAGE_COLORS[id], enabled: true
}))

// Cache so we don't refetch every render
let cachedConfig = null
let cachedCompanyId = null

export function usePipeline(companyId) {
  const [config, setConfig] = useState(cachedCompanyId === companyId ? cachedConfig : null)

  useEffect(() => {
    if (!companyId) return
    if (cachedCompanyId === companyId && cachedConfig) { setConfig(cachedConfig); return }

    supabase.from('companies').select('settings').eq('id', companyId).single().then(({ data }) => {
      const s = data?.settings || {}
      const stages = s.pipeline_stages || DEFAULT_STAGES
      const c = {
        stages: stages.filter(st => st.enabled),
        allStages: stages,
        stageIds: stages.filter(st => st.enabled).map(st => st.id),
        labels: Object.fromEntries(stages.map(st => [st.id, st.label])),
        colors: Object.fromEntries(stages.map(st => [st.id, st.color])),
        scheduleRule: s.schedule_rule || 'any',
        acceptedStages: s.accepted_stages || ['active', 'completed', 'invoiced', 'closed']
      }
      cachedConfig = c
      cachedCompanyId = companyId
      setConfig(c)
    })
  }, [companyId])

  // Fallback while loading
  if (!config) return {
    stages: DEFAULT_STAGES,
    allStages: DEFAULT_STAGES,
    stageIds: JOB_STAGES,
    labels: STAGE_LABELS,
    colors: STAGE_COLORS,
    scheduleRule: 'any',
    acceptedStages: ['active', 'completed', 'invoiced', 'closed'],
    canSchedule: () => true
  }

  return {
    ...config,
    canSchedule: (jobStage) => {
      if (config.scheduleRule === 'any') return true
      return config.acceptedStages.includes(jobStage)
    }
  }
}

// Invalidate cache when settings change
export function invalidatePipelineCache() {
  cachedConfig = null
  cachedCompanyId = null
}
