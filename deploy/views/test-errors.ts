/**
 * Test Errors Page HTML template
 *
 * TODO: Extract from lambda-handler.ts handleTestErrors()
 */

export function getTestErrorsHtml(siteId: string, apiEndpoint: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error Tracking Test Page</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f1117; color: #e5e7eb; padding: 2rem; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { margin-bottom: 1rem; }
    button { background: #3b82f6; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; cursor: pointer; margin: 0.5rem; }
    button:hover { background: #2563eb; }
    .section { margin: 2rem 0; padding: 1rem; background: #1f2937; border-radius: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Error Tracking Test Page</h1>
    <p>Site ID: ${siteId}</p>

    <div class="section">
      <h2>Test Error Types</h2>
      <button onclick="testSyntaxError()">Trigger Syntax Error</button>
      <button onclick="testTypeError()">Trigger Type Error</button>
      <button onclick="testReferenceError()">Trigger Reference Error</button>
      <button onclick="testCustomError()">Trigger Custom Error</button>
    </div>

    <script>
      const API = '${apiEndpoint}'
      const SITE_ID = '${siteId}'

      function testSyntaxError() {
        eval('function() {')
      }

      function testTypeError() {
        null.toString()
      }

      function testReferenceError() {
        undefinedVariable.doSomething()
      }

      function testCustomError() {
        throw new Error('Test custom error from test page')
      }

      window.onerror = function(msg, source, line, col, error) {
        console.log('Caught error:', msg)
        fetch(API + '/collect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            s: SITE_ID,
            e: 'error',
            u: window.location.href,
            p: { message: msg, source: source, line: line, col: col, stack: error?.stack }
          })
        })
        return false
      }
    </script>
  </div>
</body>
</html>`
}
