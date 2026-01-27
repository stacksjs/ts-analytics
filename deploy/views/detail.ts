/**
 * Detail Page HTML template (for pages, referrers, etc.)
 *
 * TODO: Extract from lambda-handler.ts handleDetailPage()
 */

export function getDetailPageHtml(
  section: string,
  siteId: string,
  apiEndpoint: string,
  title: string,
  iconPath: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Analytics</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f1117; color: #e5e7eb; padding: 2rem; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
    h1 svg { width: 24px; height: 24px; }
    .back { color: #60a5fa; text-decoration: none; margin-bottom: 1rem; display: inline-block; }
    .back:hover { text-decoration: underline; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #374151; }
    th { color: #9ca3af; font-weight: 500; }
    .loading { color: #9ca3af; padding: 2rem; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <a class="back" href="/dashboard?siteId=${encodeURIComponent(siteId)}">&larr; Back to Dashboard</a>
    <h1>
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">${iconPath}</svg>
      ${title}
    </h1>
    <div id="content" class="loading">Loading...</div>
  </div>

  <script>
    const API = '${apiEndpoint}'
    const SITE_ID = '${siteId}'
    const SECTION = '${section}'

    async function loadData() {
      try {
        const res = await fetch(\`\${API}/api/sites/\${SITE_ID}/\${SECTION}\`)
        if (!res.ok) throw new Error('Failed to load')
        const data = await res.json()
        renderData(data)
      } catch (err) {
        document.getElementById('content').innerHTML = '<p>Failed to load data</p>'
      }
    }

    function renderData(data) {
      const items = data[SECTION] || data.pages || data.referrers || data.browsers || data.countries || data.campaigns || data.events || data.goals || []
      if (items.length === 0) {
        document.getElementById('content').innerHTML = '<p>No data available</p>'
        return
      }

      const keys = Object.keys(items[0])
      let html = '<table><thead><tr>'
      keys.forEach(k => html += '<th>' + k + '</th>')
      html += '</tr></thead><tbody>'
      items.forEach(item => {
        html += '<tr>'
        keys.forEach(k => html += '<td>' + (item[k] ?? '-') + '</td>')
        html += '</tr>'
      })
      html += '</tbody></table>'
      document.getElementById('content').innerHTML = html
    }

    loadData()
  </script>
</body>
</html>`
}
