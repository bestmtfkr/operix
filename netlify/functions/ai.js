// Netlify serverless function — holds API key server-side
// Frontend calls /.netlify/functions/ai with a prompt
// This function calls Anthropic and returns the response

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST'
      }
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  try {
    const body = await req.json()
    const { prompt, system, max_tokens } = body

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Prompt required' }), { status: 400 })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 1024,
        system: system || 'You are a helpful assistant for a facility management company. Be concise and professional.',
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic API error:', err)
      return new Response(JSON.stringify({ error: 'AI service error' }), { status: 500 })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''

    return new Response(JSON.stringify({ result: text }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })

  } catch (error) {
    console.error('Function error:', error)
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 })
  }
}

export const config = { path: '/.netlify/functions/ai' }
