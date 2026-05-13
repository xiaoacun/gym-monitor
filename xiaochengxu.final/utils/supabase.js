const SUPABASE_URL = 'https://aikgfrjvockpqhswingw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpa2dmcmp2b2NrcHFoc3dpbmd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjc4MzYsImV4cCI6MjA5MzY0MzgzNn0.lkoksXlLvwpjmpEZo4UFSy3_IAucU-b9Oky-I-yEmaU';

function supabaseRequest(table, method, options = {}) {
  const { id, data, query, select } = options
  let url = `${SUPABASE_URL}/rest/v1/${table}`
  const params = []

  if (id) {
    url += `?id=eq.${id}`
  }

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        params.push(`${key}=in.(${value.map(v => `"${v}"`).join(',')})`)
      } else {
        params.push(`${key}=eq.${value}`)
      }
    })
  }

  if (select) {
    params.push(`select=${select}`)
  }

  if (params.length > 0) {
    url += (url.includes('?') ? '&' : '?') + params.join('&')
  }

  console.log('[Supabase] Request URL:', url)

  const header = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data: data || {},
      header,
      success: (res) => {
        console.log('[Supabase] Response:', res.statusCode, res.data)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, data: res.data })
        } else {
          reject({ success: false, error: res.data || res.statusCode })
        }
      },
      fail: (err) => {
        console.error('[Supabase] Request failed:', err)
        reject({ success: false, error: err.errMsg })
      }
    })
  })
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  supabaseRequest
}
