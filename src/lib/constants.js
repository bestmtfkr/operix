// Pipeline stages
export const JOB_STAGES = ['lead', 'quoted', 'active', 'completed', 'invoiced', 'closed']

export const STAGE_LABELS = {
  lead: 'Lead',
  quoted: 'Quoted',
  active: 'Active',
  completed: 'Completed',
  invoiced: 'Invoiced',
  closed: 'Closed'
}

export const STAGE_COLORS = {
  lead: '#8B5CF6',
  quoted: '#2196F3',
  active: '#00D4A0',
  completed: '#FFB800',
  invoiced: '#FF6B35',
  closed: '#3D4A5C'
}

// Job priorities
export const PRIORITIES = ['emergency', 'urgent', 'normal', 'low']

export const PRIORITY_LABELS = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  normal: 'Normal',
  low: 'Low'
}

export const PRIORITY_COLORS = {
  emergency: '#FF3B5C',
  urgent: '#FF6B35',
  normal: '#2196F3',
  low: '#3D4A5C'
}

// Job types (restoration + facility management)
export const JOB_TYPES = [
  'water_damage',
  'fire_damage',
  'mold_remediation',
  'storm_damage',
  'hvac',
  'plumbing',
  'electrical',
  'cleaning',
  'maintenance',
  'inspection',
  'renovation',
  'general'
]

export const JOB_TYPE_LABELS = {
  water_damage: 'Water Damage',
  fire_damage: 'Fire Damage',
  mold_remediation: 'Mold Remediation',
  storm_damage: 'Storm Damage',
  hvac: 'HVAC',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  cleaning: 'Cleaning',
  maintenance: 'Maintenance',
  inspection: 'Inspection',
  renovation: 'Renovation',
  general: 'General'
}

// Invoice statuses
export const INVOICE_STATUSES = ['draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void']

export const INVOICE_STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  partial: 'Partial',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void'
}

// Task statuses
export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'cancelled']

// Worker roles
export const WORKER_ROLES = ['technician', 'lead', 'foreman', 'apprentice', 'subcontractor']

// Client types
export const CLIENT_TYPES = ['commercial', 'residential', 'insurance', 'government']

// Quote statuses
export const QUOTE_STATUSES = ['draft', 'sent', 'viewed', 'approved', 'declined', 'expired']

// Tax presets by province/state
export const TAX_PRESETS = {
  ON: { mode: 'hst', label1: 'HST', rate1: 0.13, label2: null, rate2: null },
  BC: { mode: 'gst_pst', label1: 'GST', rate1: 0.05, label2: 'PST', rate2: 0.07 },
  AB: { mode: 'gst', label1: 'GST', rate1: 0.05, label2: null, rate2: null },
  QC: { mode: 'gst_qst', label1: 'GST', rate1: 0.05, label2: 'QST', rate2: 0.09975 },
  SK: { mode: 'gst_pst', label1: 'GST', rate1: 0.05, label2: 'PST', rate2: 0.06 },
  MB: { mode: 'gst_pst', label1: 'GST', rate1: 0.05, label2: 'PST', rate2: 0.07 },
  NB: { mode: 'hst', label1: 'HST', rate1: 0.15, label2: null, rate2: null },
  NS: { mode: 'hst', label1: 'HST', rate1: 0.15, label2: null, rate2: null },
  PE: { mode: 'hst', label1: 'HST', rate1: 0.15, label2: null, rate2: null },
  NL: { mode: 'hst', label1: 'HST', rate1: 0.15, label2: null, rate2: null },
}
