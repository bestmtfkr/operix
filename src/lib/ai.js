// AI helper — calls Netlify serverless function which holds the API key
export async function askAI(prompt, system, maxTokens) {
  try {
    const res = await fetch('/.netlify/functions/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, system, max_tokens: maxTokens || 1024 })
    })

    if (!res.ok) throw new Error('AI request failed')
    const data = await res.json()
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
  return askAIJSON(description, `You are an AI assistant for a facility management / restoration company.
Based on the following description (could be a phone call summary, email, or notes), extract job details and return JSON:
{
  "name": "short job name, e.g. 'Water Damage - 45 King St'",
  "description": "detailed scope of work",
  "job_type": "water_damage" | "fire_damage" | "mold_remediation" | "storm_damage" | "hvac" | "plumbing" | "electrical" | "cleaning" | "maintenance" | "inspection" | "renovation" | "general",
  "priority": "emergency" | "urgent" | "normal" | "low",
  "estimated_value": number or null,
  "client_name": "if mentioned",
  "site_address": "if mentioned",
  "site_city": "if mentioned",
  "insurance_company": "if mentioned",
  "insurance_claim_number": "if mentioned"
}
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
