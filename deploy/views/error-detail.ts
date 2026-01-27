/**
 * Error Detail Page HTML template
 *
 * TODO: Extract from lambda-handler.ts handleErrorDetailPage()
 */

export function getErrorDetailHtml(errorId: string, siteId: string, apiEndpoint: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error Details</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f1117; color: #e5e7eb; padding: 2rem; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { margin-bottom: 1rem; }
    .error-id { font-family: monospace; background: #1f2937; padding: 0.5rem 1rem; border-radius: 0.5rem; margin-bottom: 1rem; }
    .back { color: #60a5fa; text-decoration: none; }
    .back:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <a class="back" href="/dashboard?siteId=${encodeURIComponent(siteId)}">&larr; Back to Dashboard</a>
    <h1>Error Details</h1>
    <div class="error-id">Error ID: ${errorId}</div>
    <p>Loading error details from API...</p>
    <script>
      const API = '${apiEndpoint}'
      const SITE_ID = '${siteId}'
      const ERROR_ID = '${errorId}'
      // TODO: Fetch and display error details
    </script>
  </div>
</body>
</html>`
}
