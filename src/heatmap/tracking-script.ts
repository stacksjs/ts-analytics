/**
 * Heatmap Tracking Script Generator
 *
 * Generates client-side JavaScript for tracking clicks, mouse movements,
 * and scroll positions for heatmap visualization.
 */

import type { HeatmapConfig } from './types'

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate the heatmap tracking code
 */
export function buildHeatmapTracking(config: HeatmapConfig): string {
  const parts: string[] = []

  // Configuration
  parts.push(buildHeatmapConfig(config))
  parts.push('')

  // CSS selector generator
  parts.push(buildSelectorGenerator(config.selectorDepth ?? 5))
  parts.push('')

  // Movement buffer
  if (config.trackMovements) {
    parts.push(buildMovementBuffer(config))
    parts.push('')
  }

  // Scroll tracking buffer
  if (config.trackScrollPositions) {
    parts.push(buildScrollBuffer())
    parts.push('')
  }

  // Click tracking
  if (config.trackClicks !== false) {
    parts.push(buildClickTracking())
    parts.push('')
  }

  // Movement tracking
  if (config.trackMovements) {
    parts.push(buildMovementTracking(config))
    parts.push('')
  }

  // Scroll position tracking
  if (config.trackScrollPositions) {
    parts.push(buildScrollPositionTracking())
    parts.push('')
  }

  // Flush on unload
  parts.push(buildFlushOnUnload(config))
  parts.push('')

  // Initialization
  parts.push(buildHeatmapInit(config))

  return parts.join('\n')
}

// ============================================================================
// Section Builders
// ============================================================================

function buildHeatmapConfig(config: HeatmapConfig): string {
  return `// Heatmap Configuration
var HEATMAP_CONFIG = {
  trackClicks: ${config.trackClicks !== false},
  trackMovements: ${config.trackMovements ?? false},
  trackScrollPositions: ${config.trackScrollPositions ?? false},
  movementSampleInterval: ${config.movementSampleInterval ?? 100},
  maxMovementPoints: ${config.maxMovementPoints ?? 500},
  flushInterval: ${config.flushInterval ?? 5000},
  debug: ${config.debug ?? false}
};

function hmLog() {
  if (HEATMAP_CONFIG.debug && console && console.log) {
    console.log.apply(console, ['[Heatmap]'].concat(Array.prototype.slice.call(arguments)));
  }
}`
}

function buildSelectorGenerator(maxDepth: number): string {
  return `// CSS Selector Generator
function getSelector(el, maxDepth) {
  maxDepth = maxDepth || ${maxDepth};
  var path = [];
  var depth = 0;

  while (el && el.nodeType === 1 && depth < maxDepth) {
    var selector = el.nodeName.toLowerCase();

    // Use ID if available (most specific)
    if (el.id) {
      path.unshift('#' + el.id);
      break;
    }

    // Use data-testid or data-analytics-id if available
    var testId = el.getAttribute('data-testid') || el.getAttribute('data-analytics-id');
    if (testId) {
      path.unshift('[data-testid="' + testId + '"]');
      break;
    }

    // Use classes if available (limited)
    var classes = el.className;
    if (typeof classes === 'string' && classes.trim()) {
      var classList = classes.trim().split(/\\s+/).slice(0, 2);
      selector += '.' + classList.join('.');
    }

    // Add nth-child for specificity
    var parent = el.parentNode;
    if (parent) {
      var siblings = parent.children;
      var index = 1;
      for (var i = 0; i < siblings.length; i++) {
        if (siblings[i] === el) break;
        if (siblings[i].nodeName === el.nodeName) index++;
      }
      if (siblings.length > 1) {
        selector += ':nth-of-type(' + index + ')';
      }
    }

    path.unshift(selector);
    el = el.parentNode;
    depth++;
  }

  return path.join(' > ');
}

function getDataAttributes(el) {
  var attrs = {};
  if (el.dataset) {
    for (var key in el.dataset) {
      if (el.dataset.hasOwnProperty(key)) {
        attrs[key] = el.dataset[key];
      }
    }
  }
  return Object.keys(attrs).length > 0 ? attrs : null;
}`
}

function buildMovementBuffer(config: HeatmapConfig): string {
  return `// Movement Buffer
var movementBuffer = [];
var lastMovementFlush = Date.now();
var movementFlushTimer = null;

function flushMovements() {
  if (movementBuffer.length === 0) return;

  var batch = {
    points: movementBuffer.slice(),
    vw: window.innerWidth,
    vh: window.innerHeight
  };

  movementBuffer = [];
  lastMovementFlush = Date.now();

  sendBeacon({
    s: CONFIG.siteId,
    sid: session.id,
    e: 'hm_move',
    u: window.location.pathname,
    p: batch,
    ts: Date.now()
  });

  hmLog('Flushed', batch.points.length, 'movement points');
}

function scheduleMovementFlush() {
  if (movementFlushTimer) return;
  movementFlushTimer = setTimeout(function() {
    movementFlushTimer = null;
    flushMovements();
  }, ${config.flushInterval ?? 5000});
}`
}

function buildScrollBuffer(): string {
  return `// Scroll Buffer
var scrollDepthTimes = {};
var maxScrollDepth = 0;
var scrollStartTime = Date.now();
var lastScrollDepth = 0;

function updateScrollDepth() {
  var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  var docHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  ) - window.innerHeight;

  if (docHeight <= 0) return;

  var depth = Math.min(100, Math.round((scrollTop / docHeight) * 100));

  // Track time at each 10% increment
  var depthBucket = Math.floor(depth / 10) * 10;

  if (depthBucket > 0) {
    var now = Date.now();
    var timeAtPrevDepth = now - scrollStartTime;

    // Update time spent at previous depth bucket
    if (lastScrollDepth > 0) {
      var prevBucket = Math.floor(lastScrollDepth / 10) * 10;
      scrollDepthTimes[prevBucket] = (scrollDepthTimes[prevBucket] || 0) + timeAtPrevDepth;
    }

    scrollStartTime = now;
    lastScrollDepth = depth;
  }

  if (depth > maxScrollDepth) {
    maxScrollDepth = depth;
  }
}

function getScrollData() {
  // Final update
  if (lastScrollDepth > 0) {
    var prevBucket = Math.floor(lastScrollDepth / 10) * 10;
    scrollDepthTimes[prevBucket] = (scrollDepthTimes[prevBucket] || 0) + (Date.now() - scrollStartTime);
  }

  return {
    depths: scrollDepthTimes,
    maxDepth: maxScrollDepth,
    maxY: window.pageYOffset || document.documentElement.scrollTop,
    docHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    vh: window.innerHeight
  };
}`
}

function buildClickTracking(): string {
  return `// Click Tracking
function trackClick(event) {
  var el = event.target;
  if (!el || el.nodeType !== 1) return;

  // Get coordinates
  var rect = document.documentElement.getBoundingClientRect();
  var viewportX = event.clientX;
  var viewportY = event.clientY;
  var documentX = event.pageX;
  var documentY = event.pageY;

  // Get element info
  var selector = getSelector(el);
  var tag = el.tagName.toLowerCase();
  var text = (el.textContent || el.innerText || '').trim().substring(0, 50);
  var dataAttrs = getDataAttributes(el);

  var clickData = {
    vx: viewportX,
    vy: viewportY,
    dx: documentX,
    dy: documentY,
    selector: selector,
    tag: tag,
    vw: window.innerWidth,
    vh: window.innerHeight
  };

  if (text) clickData.text = text;
  if (dataAttrs) clickData.dataAttrs = dataAttrs;

  sendBeacon({
    s: CONFIG.siteId,
    sid: session.id,
    e: 'hm_click',
    u: window.location.pathname,
    p: clickData,
    ts: Date.now()
  });

  hmLog('Click tracked:', selector, 'at', viewportX, viewportY);
}

document.addEventListener('click', trackClick, true);`
}

function buildMovementTracking(config: HeatmapConfig): string {
  return `// Movement Tracking
var lastMovementTime = 0;
var rafId = null;

function trackMovement(event) {
  var now = Date.now();
  if (now - lastMovementTime < HEATMAP_CONFIG.movementSampleInterval) return;
  lastMovementTime = now;

  // Normalize to percentage of viewport
  var x = Math.round((event.clientX / window.innerWidth) * 100);
  var y = Math.round((event.clientY / window.innerHeight) * 100);

  movementBuffer.push([x, y, now]);

  // Flush if buffer is full
  if (movementBuffer.length >= HEATMAP_CONFIG.maxMovementPoints) {
    flushMovements();
  } else {
    scheduleMovementFlush();
  }
}

document.addEventListener('mousemove', function(event) {
  if (rafId) return;
  rafId = requestAnimationFrame(function() {
    rafId = null;
    trackMovement(event);
  });
}, { passive: true });`
}

function buildScrollPositionTracking(): string {
  return `// Scroll Position Tracking
var scrollTrackThrottle = null;

window.addEventListener('scroll', function() {
  if (scrollTrackThrottle) return;
  scrollTrackThrottle = setTimeout(function() {
    scrollTrackThrottle = null;
    updateScrollDepth();
  }, 100);
}, { passive: true });`
}

function buildFlushOnUnload(config: HeatmapConfig): string {
  const parts: string[] = [
    `// Flush on Unload
function flushAllHeatmapData() {`,
  ]

  if (config.trackMovements) {
    parts.push(`  if (movementBuffer.length > 0) {
    flushMovements();
  }`)
  }

  if (config.trackScrollPositions) {
    parts.push(`
  var scrollData = getScrollData();
  if (scrollData.maxDepth > 0) {
    sendBeacon({
      s: CONFIG.siteId,
      sid: session.id,
      e: 'hm_scroll',
      u: window.location.pathname,
      p: scrollData,
      ts: Date.now()
    });
    hmLog('Scroll data flushed:', scrollData);
  }`)
  }

  parts.push(`}

window.addEventListener('beforeunload', flushAllHeatmapData);
window.addEventListener('pagehide', flushAllHeatmapData);

// Also flush periodically
setInterval(function() {
  if (movementBuffer && movementBuffer.length > 0) {
    flushMovements();
  }
}, ${config.flushInterval ?? 5000});`)

  return parts.join('\n')
}

function buildHeatmapInit(config: HeatmapConfig): string {
  return `// Heatmap Initialization
hmLog('Heatmap tracking initialized');
hmLog('Click tracking:', HEATMAP_CONFIG.trackClicks);
hmLog('Movement tracking:', HEATMAP_CONFIG.trackMovements);
hmLog('Scroll tracking:', HEATMAP_CONFIG.trackScrollPositions);`
}

// ============================================================================
// Integration
// ============================================================================

/**
 * Generate a standalone heatmap tracking script
 */
export function generateHeatmapScript(
  siteId: string,
  apiEndpoint: string,
  config: HeatmapConfig = {},
): string {
  const fullConfig: HeatmapConfig = {
    trackClicks: true,
    trackMovements: false,
    trackScrollPositions: true,
    ...config,
  }

  return `(function(window, document) {
"use strict";

// Base configuration (assumes main tracking script is loaded)
if (typeof CONFIG === 'undefined') {
  window.CONFIG = {
    siteId: '${siteId}',
    endpoint: '${apiEndpoint}/collect',
    debug: ${config.debug ?? false}
  };
}

if (typeof session === 'undefined') {
  window.session = { id: 'hm-' + Date.now() };
}

if (typeof sendBeacon === 'undefined') {
  window.sendBeacon = function(data) {
    var payload = JSON.stringify(data);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.endpoint, payload);
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', CONFIG.endpoint, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(payload);
    }
  };
}

${buildHeatmapTracking(fullConfig)}

})(window, document);`
}
