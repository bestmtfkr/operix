// AI helper — calls Netlify serverless function which holds the API key
export async function askAI(prompt, system, maxTokens) {
  try {
    const res = await fetch('/.netlify/functions/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, system, max_tokens: maxTokens || 1024 })
    })

    const data = await res.json()
    if (!res.ok) {
      console.error('AI error:', data)
      throw new Error(data.error || 'AI request failed')
    }
    return data.result
  } catch (err) {
    console.error('AI error:', err)
    return null
  }
}

// Parse AI response as JSON (with fallback)
export async function askAIJSON(prompt, system, maxTokens) {
  const result = await askAI(prompt, system, maxTokens)
  if (!result) return null
  try {
    // Extract JSON from response (handles markdown code blocks)
    const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/) || result.match(/\{[\s\S]*\}/)
    if (jsonMatch) return JSON.parse(jsonMatch[1] || jsonMatch[0])
    return JSON.parse(result)
  } catch {
    console.error('Failed to parse AI JSON:', result)
    return null
  }
}

// ─── SPECIFIC AI FUNCTIONS ──────────────────────

// Analyze an email and extract structured data
export async function analyzeEmail(emailText) {
  return askAIJSON(emailText, `You are an AI assistant for a facility management / restoration company.
Analyze the following email and return a JSON object with:
{
  "from_name": "sender name",
  "from_email": "sender email if visible",
  "subject": "email subject or summary",
  "category": "insurance" | "client" | "supplier" | "pm" | "internal" | "urgent",
  "priority": "urgent" | "high" | "normal" | "low",
  "summary": "2-3 sentence summary of what this email is about and what action is needed",
  "suggested_action": "create_job" | "update_job" | "create_invoice" | "follow_up" | "none",
  "extracted_data": {
    "client_name": "if mentioned",
    "address": "if mentioned",
    "claim_number": "if mentioned",
    "amount": "if mentioned",
    "deadline": "if mentioned"
  },
  "draft_reply": "professional 3-4 sentence reply"
}
Only return valid JSON, no other text.`)
}

// Generate job details from a description
export async function generateJobFromDescription(description) {
  return askAIJSON(description, `You are an AI assistant for a facility management / restoration company in Canada.
Based on the following description (could be a phone call summary, email, or notes), extract job details and return JSON:
{
  "name": "short job name including address, e.g. 'Water Damage - 45 King St'",
  "description": "a clean, professional scope of work summarizing what needs to be done. Include specific details like unit numbers, room types, materials needed. This goes in the job description field.",
  "notes": "put any extra details here that don't fit the scope — unit lists, special instructions, measurements, options to discuss with client, access codes, contact info",
  "job_type": "water_damage" | "fire_damage" | "mold_remediation" | "storm_damage" | "hvac" | "plumbing" | "electrical" | "cleaning" | "maintenance" | "inspection" | "renovation" | "general",
  "priority": "emergency" | "urgent" | "normal" | "low",
  "estimated_value": number or null (estimate if enough info is given),
  "client_name": "client or property manager name if mentioned, otherwise null",
  "site_address": "street address only (no city/province)",
  "site_city": "city name — try to infer from context if not explicitly stated",
  "site_province_state": "province or state code (e.g. QC, ON, BC) — infer from context like area codes, street names, language used",
  "insurance_company": "if mentioned, otherwise null",
  "insurance_claim_number": "if mentioned, otherwise null",
  "unit_numbers": "comma-separated list of unit/apartment numbers if mentioned (e.g. '820, 416, 1003')"
}
IMPORTANT: Always try to fill site_city and site_province_state even if you have to infer from clues in the text (French text = likely QC, 514/438 area code = Montreal QC, 416/647 = Toronto ON, etc).
Put unit numbers, detailed breakdowns, and options in the "notes" field, not in the description.
Only return valid JSON, no other text.`)
}

// Generate professional invoice line descriptions
export async function improveLineDescription(description, jobContext) {
  return askAI(
    `Improve this invoice line item description for a professional invoice: "${description}". Job context: ${jobContext || 'facility management work'}. Return only the improved description text, nothing else. Keep it concise (1-2 lines).`,
    'You write professional, clear invoice line item descriptions for facility management and restoration companies. Be specific and concise.'
  )
}

// Generate AI insights for dashboard
export async function generateInsights(statsData) {
  return askAI(
    `Based on these business metrics, give 3 brief actionable insights (one sentence each, bullet points):
${JSON.stringify(statsData)}`,
    'You are a business analyst for a facility management company. Give practical, actionable insights based on the data. Be direct and specific. Format as bullet points.'
  )
}
