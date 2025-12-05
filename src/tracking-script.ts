/**
 * Tracking Script Generator
 *
 * Generates a comprehensive client-side tracking script for web analytics.
 * Supports page views, custom events, scroll tracking, outbound links, and more.
 */

// ============================================================================
// Types
// ============================================================================

export interface TrackingScriptConfig {
  /** Site ID */
  siteId: string
  /** API endpoint for collecting events */
  apiEndpoint: string
  /** Enable automatic page view tracking */
  autoPageView?: boolean
  /** Track hash changes as page views */
  trackHashChanges?: boolean
  /** Track outbound link clicks */
  trackOutboundLinks?: boolean
  /** Track scroll depth (percentages) */
  trackScrollDepth?: number[]
  /** Track time on page (intervals in seconds) */
  trackTimeOnPage?: number[]
  /** Respect Do Not Track header */
  honorDnt?: boolean
  /** Cookie domain (for cross-subdomain tracking) */
  cookieDomain?: string
  /** Session timeout in minutes */
  sessionTimeout?: number
  /** Custom data attributes prefix */
  dataAttributePrefix?: string
  /** Debug mode */
  debug?: boolean
  /** Callback for errors */
  onError?: string // Function name
  /** Excluded paths (regex patterns) */
  excludePaths?: string[]
  /** Exclude query params from tracking */
  excludeQueryParams?: boolean
  /** Minify the output */
  minify?: boolean
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate a comprehensive tracking script
 *
 * @example
 * ```ts
 * const script = generateFullTrackingScript({
 *   siteId: 'my-site',
 *   apiEndpoint: 'https://analytics.example.com/api/analytics',
 *   trackScrollDepth: [25, 50, 75, 100],
 *   trackOutboundLinks: true,
 * })
 *
 * // Add to HTML
 * res.send(`<script>${script}</script>`)
 * ```
 */
export function generateFullTrackingScript(config: TrackingScriptConfig): string {
  const script = buildScript(config)
  return config.minify ? minifyScript(script) : script
}

/**
 * Generate just the tracking snippet (loader)
 */
export function generateTrackingSnippet(config: Pick<TrackingScriptConfig, 'siteId' | 'apiEndpoint'>): string {
  return `<script>
(function(w,d,s,a){
  w.sa=w.sa||function(){(w.sa.q=w.sa.q||[]).push(arguments)};
  var f=d.getElementsByTagName(s)[0],j=d.createElement(s);
  j.async=1;j.src='${config.apiEndpoint}/sites/${config.siteId}/tracker.js';
  f.parentNode.insertBefore(j,f);
})(window,document,'script');
sa('init','${config.siteId}');
</script>`
}

/**
 * Generate inline tracking script (no external file needed)
 */
export function generateInlineTrackingScript(config: TrackingScriptConfig): string {
  return `<script>
${generateFullTrackingScript(config)}
sa('init','${config.siteId}');
</script>`
}

// ============================================================================
// Script Builder
// ============================================================================

function buildScript(config: TrackingScriptConfig): string {
  const parts: string[] = []

  // IIFE wrapper
  parts.push('(function(window, document) {')
  parts.push('"use strict";')
  parts.push('')

  // Configuration
  parts.push(buildConfigSection(config))
  parts.push('')

  // Utilities
  parts.push(buildUtilities())
  parts.push('')

  // Session management
  parts.push(buildSessionManagement(config))
  parts.push('')

  // Core tracking
  parts.push(buildCoreTracking(config))
  parts.push('')

  // Page view tracking
  if (config.autoPageView !== false) {
    parts.push(buildPageViewTracking(config))
    parts.push('')
  }

  // Scroll tracking
  if (config.trackScrollDepth?.length) {
    parts.push(buildScrollTracking(config.trackScrollDepth))
    parts.push('')
  }

  // Time on page tracking
  if (config.trackTimeOnPage?.length) {
    parts.push(buildTimeOnPageTracking(config.trackTimeOnPage))
    parts.push('')
  }

  // Outbound link tracking
  if (config.trackOutboundLinks) {
    parts.push(buildOutboundLinkTracking(config.dataAttributePrefix))
    parts.push('')
  }

  // Public API
  parts.push(buildPublicAPI())
  parts.push('')

  // Initialization
  parts.push(buildInitialization(config))
  parts.push('')

  // Close IIFE
  parts.push('})(window, document);')

  return parts.join('\n')
}

function buildConfigSection(config: TrackingScriptConfig): string {
  return `// Configuration
var CONFIG = {
  siteId: '${config.siteId}',
  endpoint: '${config.apiEndpoint}/collect',
  honorDnt: ${config.honorDnt ?? true},
  sessionTimeout: ${(config.sessionTimeout ?? 30) * 60 * 1000},
  debug: ${config.debug ?? false},
  excludePaths: ${JSON.stringify(config.excludePaths ?? [])},
  excludeQueryParams: ${config.excludeQueryParams ?? false}
};`
}

function buildUtilities(): string {
  return `// Utilities
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function getCookie(name) {
  var value = '; ' + document.cookie;
  var parts = value.split('; ' + name + '=');
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

function setCookie(name, value, days) {
  var expires = '';
  if (days) {
    var date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = '; expires=' + date.toUTCString();
  }
  document.cookie = name + '=' + value + expires + '; path=/; SameSite=Lax';
}

function log() {
  if (CONFIG.debug && console && console.log) {
    console.log.apply(console, ['[Analytics]'].concat(Array.prototype.slice.call(arguments)));
  }
}

function shouldTrack() {
  if (CONFIG.honorDnt && navigator.doNotTrack === '1') {
    log('DNT enabled, not tracking');
    return false;
  }

  var path = window.location.pathname;
  for (var i = 0; i < CONFIG.excludePaths.length; i++) {
    if (new RegExp(CONFIG.excludePaths[i]).test(path)) {
      log('Path excluded:', path);
      return false;
    }
  }

  return true;
}

function sendBeacon(data) {
  var payload = JSON.stringify(data);

  if (navigator.sendBeacon) {
    navigator.sendBeacon(CONFIG.endpoint, payload);
    log('Sent via beacon:', data);
  } else {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', CONFIG.endpoint, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(payload);
    log('Sent via XHR:', data);
  }
}`
}

function buildSessionManagement(config: TrackingScriptConfig): string {
  return `// Session Management
var SESSION_KEY = 'sa_session';
var VISITOR_KEY = 'sa_visitor';
var session = null;

function getOrCreateVisitor() {
  var visitorId = getCookie(VISITOR_KEY);
  if (!visitorId) {
    visitorId = generateId();
    setCookie(VISITOR_KEY, visitorId, 365);
    log('Created new visitor:', visitorId);
  }
  return visitorId;
}

function getOrCreateSession() {
  var now = Date.now();
  var sessionData = null;

  try {
    var stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      sessionData = JSON.parse(stored);
    }
  } catch (e) {}

  // Check if session is expired
  if (sessionData && (now - sessionData.lastActivity) < CONFIG.sessionTimeout) {
    sessionData.lastActivity = now;
    sessionData.pageCount++;
  } else {
    // Create new session
    sessionData = {
      id: generateId(),
      startedAt: now,
      lastActivity: now,
      pageCount: 1,
      referrer: document.referrer || null
    };
    log('Created new session:', sessionData.id);
  }

  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
  } catch (e) {}

  return sessionData;
}

function updateSessionActivity() {
  session.lastActivity = Date.now();
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {}
}`
}

function buildCoreTracking(config: TrackingScriptConfig): string {
  return `// Core Tracking
function track(eventType, eventData) {
  if (!shouldTrack()) return;

  eventData = eventData || {};

  var url = window.location.href;
  if (CONFIG.excludeQueryParams) {
    url = window.location.origin + window.location.pathname;
  }

  var payload = {
    s: CONFIG.siteId,
    sid: session.id,
    e: eventType,
    u: url,
    r: session.referrer,
    t: document.title,
    sw: window.screen.width,
    sh: window.screen.height,
    ts: Date.now()
  };

  // Add event properties
  if (eventData.name) payload.en = eventData.name;
  if (eventData.category) payload.ec = eventData.category;
  if (eventData.value !== undefined) payload.ev = eventData.value;
  if (eventData.properties) payload.p = eventData.properties;

  sendBeacon(payload);
  updateSessionActivity();
}

function trackPageView(path, title) {
  track('pageview', {
    properties: {
      path: path || window.location.pathname,
      title: title || document.title
    }
  });
}

function trackEvent(name, properties, category, value) {
  track('event', {
    name: name,
    category: category,
    value: value,
    properties: properties
  });
}`
}

function buildPageViewTracking(config: TrackingScriptConfig): string {
  const hashTracking = config.trackHashChanges
    ? `
// Track hash changes
window.addEventListener('hashchange', function() {
  trackPageView();
});`
    : ''

  return `// Auto Page View Tracking
var initialPageViewSent = false;

function sendInitialPageView() {
  if (!initialPageViewSent) {
    initialPageViewSent = true;
    trackPageView();
  }
}
${hashTracking}

// Track SPA navigation
var pushState = history.pushState;
history.pushState = function() {
  pushState.apply(history, arguments);
  trackPageView();
};

var replaceState = history.replaceState;
history.replaceState = function() {
  replaceState.apply(history, arguments);
  trackPageView();
};

window.addEventListener('popstate', function() {
  trackPageView();
});`
}

function buildScrollTracking(depths: number[]): string {
  return `// Scroll Depth Tracking
var scrollDepths = ${JSON.stringify(depths)};
var scrollTracked = {};

function trackScrollDepth() {
  var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  var docHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  ) - window.innerHeight;

  if (docHeight <= 0) return;

  var scrollPercent = Math.round((scrollTop / docHeight) * 100);

  for (var i = 0; i < scrollDepths.length; i++) {
    var depth = scrollDepths[i];
    if (scrollPercent >= depth && !scrollTracked[depth]) {
      scrollTracked[depth] = true;
      trackEvent('scroll_depth', { depth: depth }, 'engagement', depth);
      log('Scroll depth reached:', depth + '%');
    }
  }
}

var scrollThrottle = null;
window.addEventListener('scroll', function() {
  if (scrollThrottle) return;
  scrollThrottle = setTimeout(function() {
    scrollThrottle = null;
    trackScrollDepth();
  }, 100);
}, { passive: true });`
}

function buildTimeOnPageTracking(intervals: number[]): string {
  return `// Time on Page Tracking
var timeIntervals = ${JSON.stringify(intervals)};
var timeTracked = {};
var pageStartTime = Date.now();

function checkTimeOnPage() {
  var elapsed = Math.floor((Date.now() - pageStartTime) / 1000);

  for (var i = 0; i < timeIntervals.length; i++) {
    var interval = timeIntervals[i];
    if (elapsed >= interval && !timeTracked[interval]) {
      timeTracked[interval] = true;
      trackEvent('time_on_page', { seconds: interval }, 'engagement', interval);
      log('Time on page reached:', interval + 's');
    }
  }
}

setInterval(checkTimeOnPage, 1000);`
}

function buildOutboundLinkTracking(prefix?: string): string {
  const dataAttr = prefix ? `data-${prefix}-track` : 'data-sa-track'
  return `// Outbound Link Tracking
function isOutboundLink(link) {
  return link.hostname !== window.location.hostname;
}

function trackOutboundLink(event) {
  var link = event.target.closest('a');
  if (!link) return;

  if (isOutboundLink(link)) {
    var url = link.href;
    var text = link.textContent || link.innerText || '';

    trackEvent('outbound_click', {
      url: url,
      text: text.trim().substring(0, 100),
      hostname: link.hostname
    }, 'outbound');

    log('Outbound link clicked:', url);
  }
}

document.addEventListener('click', trackOutboundLink);

// Track custom elements with data attribute
function trackDataElements() {
  var elements = document.querySelectorAll('[${dataAttr}]');
  elements.forEach(function(el) {
    if (el._saTracked) return;
    el._saTracked = true;

    el.addEventListener('click', function() {
      var eventName = el.getAttribute('${dataAttr}');
      var category = el.getAttribute('${dataAttr}-category') || 'interaction';
      var value = el.getAttribute('${dataAttr}-value');
      trackEvent(eventName, null, category, value ? Number(value) : undefined);
    });
  });
}

// Observe DOM changes for new elements
var observer = new MutationObserver(trackDataElements);
observer.observe(document.body, { childList: true, subtree: true });
trackDataElements();`
}

function buildPublicAPI(): string {
  return `// Public API
window.sa = function(command) {
  var args = Array.prototype.slice.call(arguments, 1);

  switch (command) {
    case 'init':
      // Already initialized via config
      log('Initialized with site:', args[0]);
      break;

    case 'track':
    case 'trackPageView':
      trackPageView(args[0], args[1]);
      break;

    case 'event':
    case 'trackEvent':
      trackEvent(args[0], args[1], args[2], args[3]);
      break;

    case 'identify':
      // Store user ID for future events
      session.userId = args[0];
      log('User identified:', args[0]);
      break;

    case 'setProperty':
      session.properties = session.properties || {};
      session.properties[args[0]] = args[1];
      break;

    case 'debug':
      CONFIG.debug = args[0] !== false;
      break;

    default:
      log('Unknown command:', command);
  }
};

// Process any queued commands
if (window.sa && window.sa.q) {
  var queue = window.sa.q;
  window.sa.q = [];
  for (var i = 0; i < queue.length; i++) {
    window.sa.apply(null, queue[i]);
  }
}`
}

function buildInitialization(config: TrackingScriptConfig): string {
  return `// Initialization
function init() {
  log('Initializing analytics...');

  // Set up session
  getOrCreateVisitor();
  session = getOrCreateSession();

  // Send initial page view
  if (document.readyState === 'complete') {
    sendInitialPageView();
  } else {
    window.addEventListener('load', sendInitialPageView);
  }

  // Track page unload for session duration
  window.addEventListener('beforeunload', function() {
    if (session) {
      var duration = Date.now() - session.startedAt;
      trackEvent('session_end', { duration: duration }, 'session', Math.floor(duration / 1000));
    }
  });

  log('Analytics initialized');
}

// Wait for DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}`
}

// ============================================================================
// Minification
// ============================================================================

function minifyScript(script: string): string {
  return script
    // Remove comments
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Remove extra whitespace
    .replace(/\n\s*\n/g, '\n')
    .replace(/^\s+/gm, '')
    .replace(/\s+$/gm, '')
    // Compact lines
    .split('\n')
    .filter(line => line.trim())
    .join('')
    // Add semicolons where needed
    .replace(/}\s*function/g, '};function')
    .replace(/}\s*var/g, '};var')
}

// ============================================================================
// Script Variants
// ============================================================================

/**
 * Generate a minimal tracking script (page views only)
 */
export function generateMinimalTrackingScript(config: Pick<TrackingScriptConfig, 'siteId' | 'apiEndpoint' | 'honorDnt'>): string {
  return `(function(){
var s='${config.siteId}',e='${config.apiEndpoint}/collect';
${config.honorDnt ? "if(navigator.doNotTrack==='1')return;" : ''}
var sid=sessionStorage.getItem('sa_s')||Math.random().toString(36).slice(2);
sessionStorage.setItem('sa_s',sid);
navigator.sendBeacon(e,JSON.stringify({
s:s,sid:sid,e:'pageview',
u:location.href,r:document.referrer,t:document.title,
sw:screen.width,sh:screen.height
}));
})();`
}

/**
 * Generate a Google Analytics 4-style tracking script
 */
export function generateGA4StyleScript(config: TrackingScriptConfig): string {
  return `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${config.siteId}', {
  send_page_view: ${config.autoPageView !== false},
  cookie_domain: '${config.cookieDomain || 'auto'}'
});

// Custom analytics layer
(function(){
  var endpoint = '${config.apiEndpoint}/collect';
  var siteId = '${config.siteId}';

  function processDataLayer() {
    while (dataLayer.length > 0) {
      var item = dataLayer.shift();
      if (typeof item === 'function') {
        item();
      } else if (item[0] === 'event') {
        navigator.sendBeacon && navigator.sendBeacon(endpoint, JSON.stringify({
          s: siteId,
          e: 'event',
          en: item[1],
          p: item[2]
        }));
      }
    }
  }

  var push = dataLayer.push;
  dataLayer.push = function() {
    push.apply(dataLayer, arguments);
    processDataLayer();
  };
})();`
}
