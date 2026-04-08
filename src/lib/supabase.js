import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gizgnbjaemxndmrherir.supabase.co'
const supabaseAnonKey = 'sb_publishable_s1UtpahARdQF4gKHShEGcw_I2eGj532'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
