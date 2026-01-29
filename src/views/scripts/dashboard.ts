    // Extend Window interface for STX loading indicator
    declare global {
      interface Window {
        stxLoading?: {
          start: () => void
          finish: () => void
          set: (value: number) => void
          clear: () => void
        }
        ANALYTICS_API_ENDPOINT?: string
        ANALYTICS_SITE_ID?: string
      }
    }

    const urlParams = new URLSearchParams(window.location.search)
    const API_ENDPOINT = window.ANALYTICS_API_ENDPOINT || urlParams.get('api') || window.location.origin
    const SITE_ID = urlParams.get('siteId') || window.ANALYTICS_SITE_ID || ''

    let siteName = "Analytics Dashboard"
    let siteId = SITE_ID
    let availableSites = []
    let currentSite = null
    let dateRange = '6h'
    let isLoading = false
    let lastUpdated = null
    let refreshInterval = null
    let previousStats = null

    // Expose globals for STX panel components
    ;(window as any).API_ENDPOINT = API_ENDPOINT
    ;(window as any).siteId = siteId
    // Note: getDateRangeParams is exposed after its definition

    // Load cached stats from localStorage
    function loadCachedStats() {
      try {
        const cached = localStorage.getItem('ts-analytics-stats-' + siteId)
        if (cached) {
          const data = JSON.parse(cached)
          // Only use cache if less than 24 hours old
          if (data.timestamp && Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
            return data.stats
          }
        }
      } catch (e) {}
      return null
    }

    function saveCachedStats(statsData) {
      try {
        localStorage.setItem('ts-analytics-stats-' + siteId, JSON.stringify({
          stats: statsData,
          timestamp: Date.now()
        }))
      } catch (e) {}
    }

    // Animate number transitions
    function animateValue(element, start, end, duration, formatter) {
      // Ensure numeric values for comparison and animation
      const startNum = typeof start === 'number' ? start : (parseFloat(start) || 0)
      const endNum = typeof end === 'number' ? end : (parseFloat(end) || 0)

      if (startNum === endNum) {
        element.textContent = formatter ? formatter(endNum) : endNum
        return
      }

      const startTime = performance.now()

      function update(currentTime) {
        const elapsed = currentTime - startTime
        const progress = Math.min(elapsed / duration, 1)
        // Ease out cubic for smooth deceleration
        const easeProgress = 1 - Math.pow(1 - progress, 3)
        const current = Math.round(startNum + (endNum - startNum) * easeProgress)
        element.textContent = formatter ? formatter(current) : current

        if (progress < 1) {
          requestAnimationFrame(update)
        }
      }
      requestAnimationFrame(update)
    }

    const cachedStats = loadCachedStats()
    let stats = cachedStats || { realtime: 0, sessions: 0, people: 0, views: 0, avgTime: "00:00", bounceRate: 0, events: 0 }
    let pages = [], referrers = [], deviceTypes = [], browsers = [], countries = [], campaigns = [], events = [], timeSeriesData = []
    let goals = [], goalStats = null
    let siteHostname = null
    let showGoalModal = false
    let editingGoal = null
    let siteHasHistoricalData = cachedStats ? true : false // Track if site has ever had data

    // New state for additional features
    let sessions = [], sessionDetail = null
    let vitals = [], errors = [], insights = []
    let activeTab = 'dashboard' // 'dashboard', 'sessions', 'vitals', 'errors', 'insights'
    let filters = { country: '', device: '', browser: '', referrer: '' }
    let comparisonStats = null
    let liveRefreshInterval = null

    // ==========================================================================
    // DOM Builder Utilities - No innerHTML needed
    // ==========================================================================

    /**
     * Create an element with attributes and children
     * @example el('div', { class: 'card' }, [el('p', {}, 'Hello')])
     */
    function el(tag: string, attrs: Record<string, any> = {}, children: (Node | string)[] | string = []): HTMLElement {
      const element = document.createElement(tag)
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'class') {
          element.className = value
        } else if (key === 'style' && typeof value === 'object') {
          Object.assign(element.style, value)
        } else if (key.startsWith('on') && typeof value === 'function') {
          element.addEventListener(key.slice(2).toLowerCase(), value)
        } else if (key === 'dataset') {
          Object.assign(element.dataset, value)
        } else if (value !== false && value !== null && value !== undefined) {
          element.setAttribute(key, String(value))
        }
      }
      if (typeof children === 'string') {
        element.textContent = children
      } else {
        for (const child of children) {
          if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child))
          } else if (child) {
            element.appendChild(child)
          }
        }
      }
      return element
    }

    /** Create a text node */
    function text(content: string): Text {
      return document.createTextNode(content)
    }

    /** Clear all children from an element */
    function clear(element: Element): void {
      while (element.firstChild) {
        element.removeChild(element.firstChild)
      }
    }

    /** Replace element's children with new content */
    function setChildren(element: Element, children: (Node | string)[]): void {
      clear(element)
      for (const child of children) {
        if (typeof child === 'string') {
          element.appendChild(document.createTextNode(child))
        } else if (child) {
          element.appendChild(child)
        }
      }
    }

    /** Create a table row */
    function tr(cells: { content: string | Node, class?: string, colspan?: number, align?: string }[]): HTMLTableRowElement {
      const row = document.createElement('tr')
      for (const cell of cells) {
        const td = document.createElement('td')
        if (cell.class) td.className = cell.class
        if (cell.colspan) td.colSpan = cell.colspan
        if (cell.align) td.style.textAlign = cell.align
        if (typeof cell.content === 'string') {
          td.textContent = cell.content
        } else {
          td.appendChild(cell.content)
        }
        row.appendChild(td)
      }
      return row
    }

    /** Create an SVG element (needs namespace) */
    function svg(html: string): SVGElement {
      const template = document.createElement('template')
      template.innerHTML = html.trim()
      return template.content.firstChild as SVGElement
    }

    /** Create a table cell - simple helper without el() */
    function td(content: string, className?: string): HTMLTableCellElement {
      const cell = document.createElement('td')
      if (className) cell.className = className
      cell.textContent = content
      return cell
    }

    /** Create a spinner element */
    function spinner(): HTMLDivElement {
      const div = document.createElement('div')
      div.className = 'spinner'
      return div
    }

    /** Create a loading state */
    function loadingState(message = 'Loading...'): HTMLDivElement {
      return el('div', { class: 'loading' }, [
        spinner(),
        el('p', {}, message)
      ]) as HTMLDivElement
    }

    /** Create an empty state */
    function emptyState(message: string): HTMLDivElement {
      return el('div', { class: 'empty-state' }, message) as HTMLDivElement
    }

    /** Create an error state */
    function errorState(message: string, retryFn?: () => void): HTMLDivElement {
      const children: (Node | string)[] = [el('p', {}, message)]
      if (retryFn) {
        children.push(el('button', { onclick: retryFn }, 'Retry'))
      }
      return el('div', { class: 'error' }, children) as HTMLDivElement
    }

    /** Create a tab panel wrapper */
    function tabPanel(title: string, content: (Node | string)[]): HTMLDivElement {
      return el('div', { class: 'tab-panel' }, [
        el('h3', { class: 'tab-title' }, title),
        ...content
      ]) as HTMLDivElement
    }

    /** Build table rows from data */
    function buildTableRows(tbody: HTMLTableSectionElement, data: any[], rowBuilder: (item: any, index: number) => HTMLTableRowElement, emptyMessage: string, colspan: number): void {
      clear(tbody)
      if (!data || data.length === 0) {
        const emptyRow = document.createElement('tr')
        const emptyCell = document.createElement('td')
        emptyCell.colSpan = colspan
        emptyCell.className = 'empty-cell'
        emptyCell.textContent = emptyMessage
        emptyRow.appendChild(emptyCell)
        tbody.appendChild(emptyRow)
      } else {
        data.forEach((item, index) => {
          tbody.appendChild(rowBuilder(item, index))
        })
      }
    }

    /** Create a link with external icon */
    function externalLink(href: string, content: string | Node, showIcon = true): HTMLAnchorElement {
      const link = document.createElement('a')
      link.href = href
      link.target = '_blank'
      link.rel = 'noopener'
      link.style.cssText = 'color:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:4px'
      if (typeof content === 'string') {
        link.appendChild(document.createTextNode(content))
      } else {
        link.appendChild(content)
      }
      if (showIcon) {
        link.appendChild(svg('<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>'))
      }
      return link
    }

    /** Set stat value with optional comparison badge */
    function setStatValue(elementId: string, value: string, change?: number): void {
      const element = document.getElementById(elementId)
      if (!element) return
      clear(element)
      element.appendChild(document.createTextNode(value))
      if (change !== undefined && comparisonData) {
        element.appendChild(compBadgeNode(change))
      }
    }

    /** Create comparison badge as a DOM node */
    function compBadgeNode(change: number): HTMLSpanElement {
      const span = document.createElement('span')
      if (change === 0 || change === null || change === undefined) {
        span.className = 'comp-badge neutral'
        span.textContent = '0%'
      } else if (change > 0) {
        span.className = 'comp-badge up'
        span.textContent = `+${change}%`
      } else {
        span.className = 'comp-badge down'
        span.textContent = `${change}%`
      }
      return span
    }

    /** Common SVG icons for reuse */
    const icons = {
      close: () => svg('<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>'),
      traffic: () => svg('<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>'),
      referrer: () => svg('<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101"/></svg>'),
      page: () => svg('<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>'),
      device: () => svg('<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>'),
      engagement: () => svg('<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>')
    }

    /** Create a modal dialog */
    function createModal(id: string, title: string | Node, content: Node[], size = ''): HTMLDivElement {
      const modalContent = el('div', { class: `modal-content ${size}`.trim() }, [
        el('div', { class: 'modal-header' }, [
          el('h3', { class: 'modal-title' }, typeof title === 'string' ? [text(title)] : [title]),
          el('button', { class: 'modal-close', onclick: closeModal }, [icons.close()])
        ]),
        el('div', { class: 'modal-body' }, content)
      ])
      const modal = el('div', { id, class: 'modal' }, [modalContent]) as HTMLDivElement
      return modal
    }

    /** Create a vital card */
    function vitalCard(metric: string, value: string, samples: number, rating: string, goodPct: number, needsImprovementPct: number, poorPct: number): HTMLDivElement {
      const children: (Node | string)[] = [
        el('div', { class: 'vital-name' }, metric),
        el('div', { class: `vital-value ${rating}` }, value),
        el('div', { class: 'vital-samples' }, `${samples} samples`)
      ]
      if (samples > 0) {
        children.push(el('div', { class: 'vital-bar' }, [
          el('div', { class: 'good', style: { width: `${goodPct}%` } }),
          el('div', { class: 'needs-improvement', style: { width: `${needsImprovementPct}%` } }),
          el('div', { class: 'poor', style: { width: `${poorPct}%` } })
        ]))
      }
      return el('div', { class: 'vital-card' }, children) as HTMLDivElement
    }

    /** Create an error card */
    function errorCard(err: any, errorId: string, status: string, severity: string, count: number): HTMLDivElement {
      const statusClass = status === 'ignored' ? 'status-ignored' : status === 'resolved' ? 'status-resolved' : 'status-new'
      const actionButtons: Node[] = []
      if (status !== 'resolved') {
        actionButtons.push(el('button', {
          class: 'btn-tiny',
          dataset: { errorId: encodeURIComponent(errorId), action: 'resolved' }
        }, '✓'))
      }
      if (status !== 'ignored') {
        actionButtons.push(el('button', {
          class: 'btn-tiny btn-secondary',
          dataset: { errorId: encodeURIComponent(errorId), action: 'ignored' }
        }, '✕'))
      }

      return el('div', { class: 'error-card-wrapper' }, [
        el('a', {
          href: `/errors/${siteId}/${encodeURIComponent(errorId)}`,
          class: `error-card ${statusClass}`,
          target: '_blank'
        }, [
          el('div', { class: `error-severity ${severity}` }, severity),
          el('div', { class: 'error-content' }, [
            el('div', { class: 'error-message' }, err.message || 'Unknown error'),
            el('div', { class: 'error-meta' }, `${count} occurrence${count !== 1 ? 's' : ''} • ${err.browser || 'Unknown browser'}`)
          ]),
          el('div', { class: 'error-actions-inline' }, actionButtons)
        ])
      ]) as HTMLDivElement
    }

    /** Create an insight card */
    function insightCard(type: string, title: string, description: string, severity: string): HTMLDivElement {
      const iconFn = icons[type] || icons.traffic
      return el('div', { class: 'insight-card' }, [
        el('div', { class: `insight-icon ${severity || 'info'}` }, [iconFn()]),
        el('div', { class: 'insight-content' }, [
          el('div', { class: 'insight-title' }, title),
          el('div', { class: 'insight-desc' }, description)
        ])
      ]) as HTMLDivElement
    }

    /** Create a live activity item */
    function activityItem(path: string, country: string, device: string, browser: string, timestamp: string): HTMLDivElement {
      return el('div', { class: 'live-activity' }, [
        el('div', { class: 'live-activity-path' }, path || '/'),
        el('div', { class: 'live-activity-meta' }, `${country || 'Unknown'} • ${device || 'Unknown'} • ${browser || 'Unknown'}`),
        el('div', { class: 'live-activity-time' }, timeAgo(timestamp))
      ]) as HTMLDivElement
    }

    /** Create a funnel card */
    function funnelCard(funnel: any, onAnalyze: () => void): HTMLDivElement {
      const steps = funnel.steps || []
      const stepsContent: (Node | string)[] = []
      steps.forEach((s, i) => {
        stepsContent.push(el('span', { class: 'funnel-step' }, `${i + 1}. ${s.name}`))
        if (i < steps.length - 1) {
          stepsContent.push(el('span', { class: 'funnel-step-arrow' }, '→'))
        }
      })

      return el('div', { class: 'funnel-card' }, [
        el('div', { class: 'funnel-card-header' }, [
          el('span', { class: 'funnel-name' }, funnel.name),
          el('button', { class: 'btn-icon', onclick: onAnalyze }, 'Analyze')
        ]),
        el('div', { class: 'funnel-steps' }, stepsContent)
      ]) as HTMLDivElement
    }

    /** Create a settings list item */
    function listItem(name: string, meta: string | null, onDelete: () => void, code?: string): HTMLDivElement {
      const children: (Node | string)[] = [
        el('span', { class: 'list-item-name' }, name)
      ]
      if (code) {
        const codeEl = document.createElement('code')
        codeEl.className = 'list-item-code'
        codeEl.textContent = code
        children.push(codeEl)
      }
      if (meta) {
        children.push(el('span', { class: 'list-item-meta' }, meta))
      }
      children.push(el('button', { class: 'btn-icon', onclick: onDelete }, 'Delete'))
      return el('div', { class: 'list-item' }, children) as HTMLDivElement
    }

    /** Create a settings panel */
    function settingsPanel(id: string, title: string, description: string | null, content: Node[], onAdd?: () => void): HTMLDivElement {
      const headerChildren: (Node | string)[] = [el('h4', {}, title)]
      if (onAdd) {
        headerChildren.push(el('button', { class: 'btn btn-secondary', onclick: onAdd }, '+ Add'))
      }
      const panelChildren: (Node | string)[] = [
        el('div', { class: 'panel-header' }, headerChildren)
      ]
      if (description) {
        panelChildren.push(el('p', { class: 'panel-desc' }, description))
      }
      panelChildren.push(el('div', { id, class: 'panel-content' }, content))
      return el('div', { class: 'settings-panel' }, panelChildren) as HTMLDivElement
    }

    /** Create an insights stat */
    function insightsStat(value: string, label: string, change?: number): HTMLDivElement {
      const children: (Node | string)[] = [
        el('div', { class: 'insights-stat-value' }, value),
        el('div', { class: 'insights-stat-label' }, label)
      ]
      if (change !== undefined && change !== 0) {
        children.push(el('div', {
          class: `insights-stat-change ${change > 0 ? 'positive' : 'negative'}`
        }, `${change > 0 ? '+' : ''}${change}%`))
      }
      return el('div', { class: 'insights-stat' }, children) as HTMLDivElement
    }

    /** Create a timeline item */
    function timelineItem(type: string, content: string, timestamp: string): HTMLDivElement {
      return el('div', { class: 'timeline-item' }, [
        el('span', { class: `timeline-type ${type}` }, type),
        el('div', { class: 'timeline-content' }, content),
        el('span', { class: 'timeline-time' }, new Date(timestamp).toLocaleTimeString())
      ]) as HTMLDivElement
    }

    /** Create a session stat */
    function sessionStat(label: string, value: string): HTMLDivElement {
      return el('div', { class: 'session-stat' }, [
        el('span', { class: 'session-stat-label' }, label),
        el('span', { class: 'session-stat-value' }, value)
      ]) as HTMLDivElement
    }

    /** Create a journey step */
    function journeyStep(path: string, duration: string): HTMLDivElement {
      return el('div', { class: 'journey-step' }, [
        el('span', { class: 'journey-path' }, path),
        el('span', { class: 'journey-duration' }, duration)
      ]) as HTMLDivElement
    }

    // Theme management
    function getPreferredTheme() {
      const stored = localStorage.getItem('ts-analytics-theme')
      if (stored) return stored
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme)
      const darkIcon = document.getElementById('theme-icon-dark')
      const lightIcon = document.getElementById('theme-icon-light')
      if (darkIcon && lightIcon) {
        darkIcon.style.display = theme === 'dark' ? 'block' : 'none'
        lightIcon.style.display = theme === 'light' ? 'block' : 'none'
      }
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'dark'
      const newTheme = current === 'dark' ? 'light' : 'dark'
      localStorage.setItem('ts-analytics-theme', newTheme)
      applyTheme(newTheme)
      // Re-render chart with new theme colors
      if (timeSeriesData.length) renderChart()
    }

    // Initialize theme immediately
    applyTheme(getPreferredTheme())

    // Browser icons (SVG)
    const browserIcons = {
      'Chrome': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="display:inline;vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#4285F4" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#4285F4"/><path d="M12 2v6" stroke="#EA4335" stroke-width="2"/><path d="M5 17l5-3" stroke="#FBBC05" stroke-width="2"/><path d="M19 17l-5-3" stroke="#34A853" stroke-width="2"/></svg>',
      'Safari': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="display:inline;vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#0FB5EE" stroke-width="2"/><path d="M12 2L14 12L12 22" stroke="#FF5722" stroke-width="1"/><path d="M2 12L12 10L22 12" stroke="#0FB5EE" stroke-width="1"/></svg>',
      'Firefox': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="display:inline;vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#FF6611" stroke-width="2" fill="#FFBD4F"/><path d="M8 8c2-2 6-2 8 0s2 6 0 8" stroke="#FF6611" stroke-width="2"/></svg>',
      'Edge': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="display:inline;vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#0078D7" stroke-width="2"/><path d="M6 12c0-4 3-6 6-6s6 2 6 6" stroke="#0078D7" stroke-width="2"/></svg>',
      'Opera': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="display:inline;vertical-align:middle;margin-right:6px"><ellipse cx="12" cy="12" rx="6" ry="10" stroke="#FF1B2D" stroke-width="2"/></svg>',
      'Brave': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="display:inline;vertical-align:middle;margin-right:6px"><path d="M12 2L4 6v6c0 5.5 3.5 10.7 8 12 4.5-1.3 8-6.5 8-12V6l-8-4z" stroke="#FB542B" stroke-width="2"/></svg>',
      'IE': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="display:inline;vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#0076D6" stroke-width="2"/><path d="M4 12h16" stroke="#0076D6" stroke-width="2"/></svg>',
      'Bot': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="2"/><circle cx="15" cy="14" r="2"/><path d="M12 2v4M6 6l2 2M18 6l-2 2"/></svg>',
    }
    function getBrowserIcon(name) {
      return browserIcons[name] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px;opacity:0.5"><circle cx="12" cy="12" r="10"/></svg>'
    }

    // Country name to flag emoji (ISO 3166-1)
    const countryFlags = {
      'United States': '\u{1F1FA}\u{1F1F8}', 'United Kingdom': '\u{1F1EC}\u{1F1E7}', 'Canada': '\u{1F1E8}\u{1F1E6}',
      'Australia': '\u{1F1E6}\u{1F1FA}', 'Germany': '\u{1F1E9}\u{1F1EA}', 'France': '\u{1F1EB}\u{1F1F7}',
      'Japan': '\u{1F1EF}\u{1F1F5}', 'China': '\u{1F1E8}\u{1F1F3}', 'India': '\u{1F1EE}\u{1F1F3}',
      'Brazil': '\u{1F1E7}\u{1F1F7}', 'Mexico': '\u{1F1F2}\u{1F1FD}', 'Spain': '\u{1F1EA}\u{1F1F8}',
      'Italy': '\u{1F1EE}\u{1F1F9}', 'Netherlands': '\u{1F1F3}\u{1F1F1}', 'Sweden': '\u{1F1F8}\u{1F1EA}',
      'Norway': '\u{1F1F3}\u{1F1F4}', 'Denmark': '\u{1F1E9}\u{1F1F0}', 'Finland': '\u{1F1EB}\u{1F1EE}',
      'Switzerland': '\u{1F1E8}\u{1F1ED}', 'Austria': '\u{1F1E6}\u{1F1F9}', 'Belgium': '\u{1F1E7}\u{1F1EA}',
      'Poland': '\u{1F1F5}\u{1F1F1}', 'Russia': '\u{1F1F7}\u{1F1FA}', 'South Korea': '\u{1F1F0}\u{1F1F7}',
      'Singapore': '\u{1F1F8}\u{1F1EC}', 'Hong Kong': '\u{1F1ED}\u{1F1F0}', 'Taiwan': '\u{1F1F9}\u{1F1FC}',
      'New Zealand': '\u{1F1F3}\u{1F1FF}', 'Ireland': '\u{1F1EE}\u{1F1EA}', 'Portugal': '\u{1F1F5}\u{1F1F9}',
      'Czech Republic': '\u{1F1E8}\u{1F1FF}', 'Greece': '\u{1F1EC}\u{1F1F7}', 'Israel': '\u{1F1EE}\u{1F1F1}',
      'South Africa': '\u{1F1FF}\u{1F1E6}', 'Argentina': '\u{1F1E6}\u{1F1F7}', 'Chile': '\u{1F1E8}\u{1F1F1}',
      'Colombia': '\u{1F1E8}\u{1F1F4}', 'Philippines': '\u{1F1F5}\u{1F1ED}', 'Thailand': '\u{1F1F9}\u{1F1ED}',
      'Malaysia': '\u{1F1F2}\u{1F1FE}', 'Indonesia': '\u{1F1EE}\u{1F1E9}', 'Vietnam': '\u{1F1FB}\u{1F1F3}',
      'UAE': '\u{1F1E6}\u{1F1EA}', 'Saudi Arabia': '\u{1F1F8}\u{1F1E6}', 'Turkey': '\u{1F1F9}\u{1F1F7}',
      'Ukraine': '\u{1F1FA}\u{1F1E6}', 'Romania': '\u{1F1F7}\u{1F1F4}', 'Hungary': '\u{1F1ED}\u{1F1FA}',
    }
    function getCountryFlag(name) {
      return countryFlags[name] || '\u{1F30D}'
    }

    // Device icons
    const deviceIcons = {
      'desktop': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
      'mobile': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
      'tablet': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
    }
    function getDeviceIcon(type) {
      return deviceIcons[type?.toLowerCase()] || deviceIcons['desktop']
    }

    async function fetchSites() {
      const container = document.getElementById('site-list')
      clear(container)
      container.appendChild(loadingState('Loading sites...'))

      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites`)
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        availableSites = data.sites || []
        renderSiteSelector()
      } catch (err) {
        clear(container)
        container.appendChild(errorState('Failed to load sites', fetchSites))
      }
    }

    function renderSiteSelector() {
      const container = document.getElementById('site-list')
      if (!container) return

      const sitesHtml = availableSites.length === 0 ? `
        <div class="empty" style="margin-top:1rem">
          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          <p>No sites yet</p>
          <p style="font-size:0.75rem;margin-top:0.5rem;color:var(--muted)">Create your first site above to start tracking analytics</p>
        </div>
      ` : `
        <h3 style="font-size:0.875rem;margin-bottom:0.75rem;color:var(--text2);width:100%;max-width:500px">Your Sites</h3>
        ${availableSites.map(s => `
          <button class="site-card" data-site-id="${s.id}" data-site-name="${s.name || ''}">
            <div class="site-icon">
              <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
            </div>
            <div class="site-info">
              <span class="site-name">${s.name || 'Unnamed'}</span>
              <span class="site-domain">${s.domains?.[0] || s.id}</span>
            </div>
            <svg class="arrow" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
          </button>
        `).join('')}
      `

      container.innerHTML = `
        <div class="create-site-form" style="margin-bottom:1.5rem;width:100%;max-width:500px">
          <h3 style="font-size:0.875rem;margin-bottom:0.75rem;color:var(--text2)">Create New Site</h3>
          <form id="create-site-form" style="display:flex;gap:0.5rem">
            <input type="text" id="new-site-name" placeholder="Site name (e.g. My Website)" required style="flex:1;padding:0.5rem 0.75rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:0.875rem">
            <input type="text" id="new-site-domain" placeholder="Domain (optional)" style="flex:1;padding:0.5rem 0.75rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:0.875rem">
            <button type="submit" style="padding:0.5rem 1rem;border-radius:6px;background:var(--accent);color:white;border:none;cursor:pointer;font-weight:500">Create</button>
          </form>
          <p id="create-site-error" style="color:var(--error);font-size:0.75rem;margin-top:0.5rem;display:none"></p>
        </div>
        ${sitesHtml}
      `

      // Add event listeners
      document.getElementById('create-site-form')?.addEventListener('submit', createSite)
      container.querySelectorAll('.site-card').forEach(card => {
        card.addEventListener('click', () => {
          selectSite((card as HTMLElement).dataset.siteId, (card as HTMLElement).dataset.siteName || '')
        })
      })
    }

    async function createSite(e) {
      e.preventDefault()
      const nameInput = document.getElementById('new-site-name')
      const domainInput = document.getElementById('new-site-domain')
      const errorEl = document.getElementById('create-site-error')

      const name = nameInput.value.trim()
      const domain = domainInput.value.trim()

      if (!name) {
        errorEl.textContent = 'Site name is required'
        errorEl.style.display = 'block'
        return
      }

      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, domain: domain || undefined })
        })
        const data = await res.json()

        if (!res.ok) {
          errorEl.textContent = data.error || 'Failed to create site'
          errorEl.style.display = 'block'
          return
        }

        errorEl.style.display = 'none'
        nameInput.value = ''
        domainInput.value = ''

        // Refresh sites list and select the new site
        await fetchSites()
        if (data.site) {
          selectSite(data.site.id, data.site.name)
        }
      } catch (err) {
        errorEl.textContent = 'Failed to create site'
        errorEl.style.display = 'block'
      }
    }

    function selectSite(id, name) {
      siteId = id
      ;(window as any).siteId = id // Update for STX panel components
      siteName = name || 'Analytics Dashboard'
      currentSite = availableSites.find(s => s.id === id)
      document.getElementById('site-selector').style.display = 'none'
      document.getElementById('dashboard').style.display = 'block'
      document.getElementById('current-site-name').textContent = siteName
      // Always navigate to /dashboard with siteId
      const url = new URL(window.location.origin + '/dashboard')
      url.searchParams.set('siteId', id)
      window.history.pushState({ tab: 'dashboard', siteId: id }, '', url)

      // Load and display cached stats immediately
      const cached = loadCachedStats()
      if (cached) {
        stats = cached
        previousStats = null
        siteHasHistoricalData = true // Site has historical data if we have cached stats
        renderDashboard(false)
      }

      fetchDashboardData()
      // Refresh all STX panel components when site is selected
      refreshAllPanels()
      if (refreshInterval) clearInterval(refreshInterval)
      refreshInterval = setInterval(fetchDashboardData, 30000)
    }

    function goBack() {
      if (refreshInterval) clearInterval(refreshInterval)
      siteId = ''
      ;(window as any).siteId = '' // Update for STX panel components
      currentSite = null
      document.getElementById('site-selector').style.display = 'flex'
      document.getElementById('dashboard').style.display = 'none'
      const url = new URL(window.location.href)
      url.searchParams.delete('siteId')
      window.history.pushState({}, '', url)
      fetchSites()
    }

    function navigateTo(section) {
      window.location.href = '/dashboard/' + section + '?siteId=' + encodeURIComponent(siteId)
    }

    function setDateRange(range) {
      dateRange = range
      document.querySelectorAll('.date-btn').forEach(btn => btn.classList.remove('active'))
      document.querySelector(`[data-range="${range}"]`).classList.add('active')
      fetchDashboardData()
      // Refresh all STX panel components
      refreshAllPanels()
    }

    function refreshAllPanels() {
      // Refresh all panel components when date range or site changes
      if (window.refreshPagesPanel) window.refreshPagesPanel()
      if (window.refreshReferrersPanel) window.refreshReferrersPanel()
      if (window.refreshDevicesPanel) window.refreshDevicesPanel()
      if (window.refreshBrowsersPanel) window.refreshBrowsersPanel()
      if (window.refreshCountriesPanel) window.refreshCountriesPanel()
      if (window.refreshCampaignsPanel) window.refreshCampaignsPanel()
      if (window.refreshEventsPanel) window.refreshEventsPanel()
      if (window.refreshGoalsPanel) window.refreshGoalsPanel()
    }
    ;(window as any).refreshAllPanels = refreshAllPanels

    function toggleComparison() {
      showComparison = !showComparison
      const btn = document.getElementById('compare-btn')
      if (btn) {
        btn.classList.toggle('active', showComparison)
        btn.style.background = showComparison ? 'var(--accent)' : ''
        btn.style.color = showComparison ? 'white' : ''
      }
      fetchDashboardData()
    }

    async function addAnnotation() {
      const type = prompt('Annotation type (deployment, campaign, incident, general):') || 'general'
      if (!['deployment', 'campaign', 'incident', 'general'].includes(type)) {
        alert('Invalid type. Use: deployment, campaign, incident, or general')
        return
      }
      const title = prompt('Title (e.g., "v2.0 Release"):')
      if (!title) return
      const description = prompt('Description (optional):') || ''
      const dateStr = prompt('Date (YYYY-MM-DD, leave empty for today):')
      const date = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString()

      try {
        await fetch(`${API_ENDPOINT}/api/sites/${siteId}/annotations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, title, description, date })
        })
        fetchDashboardData() // Refresh to show new annotation
      } catch (e) {
        console.error('Failed to add annotation:', e)
        alert('Failed to add annotation')
      }
    }

    function getDateRangeParams(forTimeseries) {
      const now = new Date()
      const end = now.toISOString()
      let start, period = 'day'
      switch(dateRange) {
        case '1h': start = new Date(now - 1*60*60*1000); period = 'minute'; break
        case '6h': start = new Date(now - 6*60*60*1000); period = 'hour'; break
        case '12h': start = new Date(now - 12*60*60*1000); period = 'hour'; break
        case '24h': start = new Date(now - 24*60*60*1000); period = 'hour'; break
        case '7d': start = new Date(now - 7*24*60*60*1000); break
        case '30d': start = new Date(now - 30*24*60*60*1000); break
        case '90d': start = new Date(now - 90*24*60*60*1000); break
        default: start = new Date(now - 30*24*60*60*1000)
      }
      let params = `?startDate=${start.toISOString()}&endDate=${end}`
      if (forTimeseries) params += `&period=${period}`
      return params
    }
    // Expose for STX panel components
    ;(window as any).getDateRangeParams = getDateRangeParams

    // Annotations and comparison state
    let annotations = []
    let showComparison = false
    let comparisonData = null

    async function fetchDashboardData() {
      if (isLoading) return
      isLoading = true
      // Use STX loading indicator if available
      if (window.stxLoading) window.stxLoading.start()
      const refreshBtn = document.getElementById('refresh-btn')
      const spinStartTime = Date.now()
      refreshBtn?.classList.add('spinning')

      const baseUrl = `${API_ENDPOINT}/api/sites/${siteId}`
      const params = getDateRangeParams(false)
      const tsParams = getDateRangeParams(true)

      try {
        const fetchPromises = [
          fetch(`${baseUrl}/stats${params}`).then(r => r.json()).catch(() => ({})),
          fetch(`${baseUrl}/realtime`).then(r => r.json()).catch(() => ({ currentVisitors: 0 })),
          fetch(`${baseUrl}/pages${params}`).then(r => r.json()).catch(() => ({ pages: [] })),
          fetch(`${baseUrl}/referrers${params}`).then(r => r.json()).catch(() => ({ referrers: [] })),
          fetch(`${baseUrl}/devices${params}`).then(r => r.json()).catch(() => ({ deviceTypes: [] })),
          fetch(`${baseUrl}/browsers${params}`).then(r => r.json()).catch(() => ({ browsers: [] })),
          fetch(`${baseUrl}/countries${params}`).then(r => r.json()).catch(() => ({ countries: [] })),
          fetch(`${baseUrl}/timeseries${tsParams}`).then(r => r.json()).catch(() => ({ timeSeries: [] })),
          fetch(`${baseUrl}/events${params}`).then(r => r.json()).catch(() => ({ events: [] })),
          fetch(`${baseUrl}/campaigns${params}`).then(r => r.json()).catch(() => ({ campaigns: [] })),
          fetch(`${baseUrl}/goals${params}`).then(r => r.json()).catch(() => ({ goals: [] })),
          fetch(`${baseUrl}/vitals${params}`).then(r => r.json()).catch(() => ({ vitals: [] })),
          fetch(`${baseUrl}/errors${params}`).then(r => r.json()).catch(() => ({ errors: [] })),
          fetch(`${baseUrl}/insights`).then(r => r.json()).catch(() => ({ insights: [] })),
          fetch(`${baseUrl}/annotations${params}`).then(r => r.json()).catch(() => ({ annotations: [] })),
        ]

        // Add comparison data fetch if enabled
        if (showComparison) {
          fetchPromises.push(fetch(`${baseUrl}/comparison${params}`).then(r => r.json()).catch(() => null))
        }

        const results = await Promise.all(fetchPromises)
        const [statsRes, realtimeRes, pagesRes, referrersRes, devicesRes, browsersRes, countriesRes, timeseriesRes, eventsRes, campaignsRes, goalsRes, vitalsRes, errorsRes, insightsRes, annotationsRes] = results
        if (showComparison && results[15]) {
          comparisonData = results[15]
        }

        previousStats = { ...stats }
        stats = {
          realtime: realtimeRes.currentVisitors || 0,
          sessions: statsRes.sessions || 0,
          people: statsRes.people || 0,
          views: statsRes.views || 0,
          avgTime: statsRes.avgTime || "00:00",
          bounceRate: statsRes.bounceRate || 0,
          events: statsRes.events || 0
        }
        saveCachedStats(stats)
        pages = pagesRes.pages || []
        siteHostname = pagesRes.hostname || null
        referrers = referrersRes.referrers || []
        deviceTypes = devicesRes.deviceTypes || []
        browsers = browsersRes.browsers || []
        countries = countriesRes.countries || []
        campaigns = campaignsRes.campaigns || []
        events = eventsRes.events || []
        goals = goalsRes.goals || []
        timeSeriesData = (timeseriesRes.timeSeries || []).map(t => ({
          date: t.timestamp || t.date,
          views: t.views,
          visitors: t.visitors
        }))
        vitals = vitalsRes.vitals || []
        errors = errorsRes.errors || []
        insights = insightsRes.insights || []
        comparisonStats = insightsRes.stats || null
        annotations = annotationsRes.annotations || []
        lastUpdated = new Date()

        // Mark site as having data if we see any (don't show setup for empty time ranges)
        if (stats.views > 0 || stats.sessions > 0 || pages.length > 0 || timeSeriesData.some(t => t.views > 0)) {
          siteHasHistoricalData = true
        }

        renderDashboard(true)
      } catch (error) {
        console.error('Failed to fetch:', error)
      } finally {
        isLoading = false
        // Finish STX loading indicator
        if (window.stxLoading) window.stxLoading.finish()
        // Ensure spin animation completes full rotations (500ms per rotation)
        const spinDuration = Date.now() - spinStartTime
        const rotationTime = 500
        // Calculate time to next rotation boundary (at least 1 full rotation)
        const completedRotations = Math.floor(spinDuration / rotationTime)
        const minRotations = Math.max(1, completedRotations + 1)
        const targetTime = minRotations * rotationTime
        const remainingTime = targetTime - spinDuration
        setTimeout(() => {
          refreshBtn?.classList.remove('spinning')
        }, remainingTime)
      }
    }

    function fmt(n) {
      if (n === undefined || n === null) return '0'
      return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n)
    }

    // Tab switching with URL routing
    let flowData = null
    let revenueData = null
    const validTabs = ['dashboard', 'live', 'sessions', 'funnels', 'flow', 'vitals', 'errors', 'insights', 'settings']

    function getTabFromUrl() {
      const url = new URL(window.location.href)
      // Check for /dashboard/:tab pattern
      const pathMatch = url.pathname.match(/\/dashboard\/([^/]+)/)
      if (pathMatch && validTabs.includes(pathMatch[1])) {
        return pathMatch[1]
      }
      // Check for ?tab= parameter
      const tabParam = url.searchParams.get('tab')
      if (tabParam && validTabs.includes(tabParam)) {
        return tabParam
      }
      return 'dashboard'
    }

    function updateUrlForTab(tab, replace = false) {
      const url = new URL(window.location.href)
      // Use path-based routing: /dashboard/:tab
      const basePath = tab === 'dashboard' ? '/dashboard' : `/dashboard/${tab}`
      url.pathname = basePath
      // Keep siteId in query params
      if (siteId) url.searchParams.set('siteId', siteId)
      url.searchParams.delete('tab') // Remove old tab param if present

      if (replace) {
        window.history.replaceState({ tab, siteId }, '', url)
      } else {
        window.history.pushState({ tab, siteId }, '', url)
      }
    }

    function switchTab(tab, updateHistory = true) {
      if (!validTabs.includes(tab)) tab = 'dashboard'

      // Clear live refresh interval when switching away from live tab
      if (activeTab === 'live' && tab !== 'live' && liveRefreshInterval) {
        clearInterval(liveRefreshInterval)
        liveRefreshInterval = null
      }

      activeTab = tab

      // Update URL if requested (not when handling popstate)
      if (updateHistory && siteId) {
        updateUrlForTab(tab)
      }

      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab)
      })
      // Hide/show appropriate content
      const statsSection = document.querySelector('.stats')
      const chartBox = document.querySelector('.chart-box')
      const dashboardPanels = document.getElementById('dashboard-panels')
      const tabContent = document.getElementById('tab-content')
      const controlsBar = document.getElementById('controls-bar')
      const filtersBar = document.getElementById('filters-bar')

      // Tabs that need date range and filters
      const tabsWithControls = ['dashboard', 'sessions', 'flow', 'live', 'funnels']
      const showControls = tabsWithControls.includes(tab)

      if (controlsBar) controlsBar.style.display = showControls ? 'flex' : 'none'
      if (filtersBar) filtersBar.style.display = showControls ? 'flex' : 'none'

      if (tab === 'dashboard') {
        if (statsSection) statsSection.style.display = 'grid'
        if (chartBox) chartBox.style.display = 'block'
        if (dashboardPanels) dashboardPanels.style.display = 'block'
        if (tabContent) tabContent.style.display = 'none'
        renderDashboard()
      } else {
        if (statsSection) statsSection.style.display = 'none'
        if (chartBox) chartBox.style.display = 'none'
        if (dashboardPanels) dashboardPanels.style.display = 'none'
        if (tabContent) tabContent.style.display = 'block'

        if (tab === 'sessions') {
          fetchSessions()
        } else if (tab === 'flow') {
          fetchUserFlow()
        } else if (tab === 'vitals') {
          renderVitals()
        } else if (tab === 'errors') {
          fetchErrorStatuses().then(() => renderErrors())
        } else if (tab === 'insights') {
          renderInsights()
        } else if (tab === 'live') {
          fetchLiveView()
        } else if (tab === 'funnels') {
          fetchFunnels()
        } else if (tab === 'settings') {
          renderSettings()
        }
      }
    }

    // Fetch user flow data
    async function fetchUserFlow() {
      const tabContent = document.getElementById('tab-content')

      // Always show loading state first
      if (tabContent) {
        clear(tabContent)
        tabContent.appendChild(tabPanel('User Flow', [
          el('div', { class: 'empty-state' }, [
            spinner(),
            text('Loading user flow data...')
          ])
        ]))
      }

      const params = getDateRangeParams(false)
      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites/${siteId}/flow${params}`)
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        }
        const data = await res.json()
        // Validate the response has expected structure
        if (data && (data.nodes || data.links)) {
          flowData = data
          renderUserFlow()
        } else {
          flowData = null
          if (tabContent) {
            clear(tabContent)
            tabContent.appendChild(tabPanel('User Flow', [
              emptyState('No flow data available. Users need to visit multiple pages in a session to generate flow data.')
            ]))
          }
        }
      } catch (e) {
        console.error('Failed to fetch user flow:', e)
        flowData = null
        if (tabContent) {
          clear(tabContent)
          tabContent.appendChild(tabPanel('User Flow', [
            emptyState('Failed to load user flow data. Please try again.')
          ]))
        }
      }
    }

    // Render user flow visualization
    function renderUserFlow() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      if (!flowData || !flowData.nodes || !flowData.links) {
        tabContent.innerHTML = `
          <div class="tab-panel">
            <h3 class="tab-title">User Flow</h3>
            <div class="empty-state">No flow data available. Users need to visit multiple pages in a session.</div>
          </div>
        `
        return
      }

      const { nodes, links, totalSessions, analyzedSessions } = flowData
      const entryNodes = nodes.filter(n => n.id === '/' || links.every(l => l.target !== n.id || l.source === n.id))

      const entryNodesHtml = entryNodes.slice(0, 8).map(n => `
        <div class="flow-node">
          <div class="flow-node-path">${n.id}</div>
          <div class="flow-node-count">${n.count} visits</div>
        </div>
      `).join('')

      const linksHtml = links.slice(0, 15).map(l => `
        <div class="flow-link">
          <span class="flow-link-source">${l.source}</span>
          <span class="flow-link-arrow">→</span>
          <span class="flow-link-target">${l.target}</span>
          <span class="flow-link-count">${l.value}x</span>
        </div>
      `).join('')

      const ranksHtml = nodes.slice(0, 10).map((n, i) => `
        <div class="flow-rank">
          <span class="flow-rank-number">${i + 1}</span>
          <span class="flow-rank-path">${n.id}</span>
          <span class="flow-rank-count">${n.count}</span>
        </div>
      `).join('')

      const emptyMessage = links.length === 0
        ? '<div class="empty-state">No flow data available. Users need to visit multiple pages in a session.</div>'
        : ''

      tabContent.innerHTML = `
        <div class="tab-panel">
          <h3 class="tab-title">User Flow</h3>
          <p id="flow-summary" class="flow-summary">Showing top paths from ${analyzedSessions} of ${totalSessions} multi-page sessions</p>
          <div class="flow-container">
            <div class="flow-column" id="flow-entry">
              <h4 class="flow-column-title">Entry Pages</h4>
              <div class="flow-nodes">${entryNodesHtml}</div>
            </div>
            <div class="flow-column flow-links" id="flow-links">
              <h4 class="flow-column-title">Top Flows</h4>
              <div class="flow-connections">${linksHtml}</div>
            </div>
            <div class="flow-column" id="flow-visited">
              <h4 class="flow-column-title">Most Visited</h4>
              <div class="flow-ranks">${ranksHtml}</div>
            </div>
          </div>
          ${emptyMessage}
        </div>
      `
    }

    // Fetch sessions list
    async function fetchSessions() {
      const params = getDateRangeParams(false)
      const filter = Object.values(filters).filter(f => f).join(' ')
      const filterParam = filter ? '&filter=' + encodeURIComponent(filter) : ''
      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites/${siteId}/sessions${params}${filterParam}`)
        const data = await res.json()
        sessions = data.sessions || []
        renderSessions()
      } catch (e) {
        console.error('Failed to fetch sessions:', e)
      }
    }

    // Render sessions list
    function renderSessions() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      const sessionsHtml = sessions.length === 0
        ? '<div class="empty-state">No sessions found</div>'
        : sessions.map(s => `
            <div class="session-card" data-session-id="${s.id}">
              <div class="session-card-header">
                <span class="session-path">${s.entryPath || '/'}</span>
                <span class="session-time">${new Date(s.startedAt).toLocaleString()}</span>
              </div>
              <div class="session-card-meta">
                <span class="session-pages">${s.pageViewCount || 0} pages</span>
                <span class="session-duration">${formatDuration(s.duration)}</span>
                <span class="session-browser">${s.browser || 'Unknown'}</span>
                <span class="session-country">${s.country || 'Unknown'}</span>
                ${s.isBounce ? '<span class="bounced">Bounced</span>' : ''}
              </div>
            </div>
          `).join('')

      tabContent.innerHTML = `
        <div class="tab-panel">
          <h3 class="tab-title">Sessions (<span id="sessions-count">${sessions.length}</span>)</h3>
          <div id="sessions-list" class="sessions-list">${sessionsHtml}</div>
        </div>
      `

      // Add click handlers
      tabContent.querySelectorAll('.session-card').forEach(card => {
        card.addEventListener('click', () => viewSession((card as HTMLElement).dataset.sessionId))
      })
    }

    // Format duration
    function formatDuration(ms) {
      if (!ms) return '0s'
      const s = Math.floor(ms / 1000)
      if (s < 60) return s + 's'
      const m = Math.floor(s / 60)
      return m + 'm ' + (s % 60) + 's'
    }

    // View session detail
    async function viewSession(sessionId) {
      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites/${siteId}/sessions/${sessionId}`)
        sessionDetail = await res.json()
        renderSessionModal()
      } catch (e) {
        console.error('Failed to fetch session:', e)
      }
    }

    // Render session modal with replay
    function renderSessionModal() {
      if (!sessionDetail) return
      let modal = document.getElementById('session-modal') as HTMLDivElement
      if (!modal) {
        modal = document.createElement('div')
        modal.id = 'session-modal'
        modal.className = 'modal-overlay'
        modal.onclick = (e) => { if (e.target === modal) closeModal() }
        document.body.appendChild(modal)
      }

      const s = sessionDetail.session
      const timeline = sessionDetail.timeline || []
      const clicks = sessionDetail.clicks || []
      const pageviews = sessionDetail.pageviews || []

      // Group clicks by path
      const clicksByPath: Record<string, any[]> = {}
      for (const c of clicks) {
        const path = c.path || '/'
        if (!clicksByPath[path]) clicksByPath[path] = []
        clicksByPath[path].push(c)
      }
      const paths = [...new Set(pageviews.map(p => p.path))] as string[]

      const statsHtml = [
        { value: String(s.pageViewCount || 0), label: 'Pages' },
        { value: formatDuration(s.duration), label: 'Duration' },
        { value: s.browser || '?', label: 'Browser' },
        { value: s.country || '?', label: 'Country' }
      ].map(item => `
        <div class="session-stat">
          <div class="session-stat-value">${item.value}</div>
          <div class="session-stat-label">${item.label}</div>
        </div>
      `).join('')

      const heatmapHtml = clicks.length > 0 ? `
        <div id="session-heatmap-section" class="session-section">
          <h4 class="session-section-title">Click Heatmap (<span id="clicks-count">${clicks.length}</span> clicks)</h4>
          <div id="heatmap-path-buttons" class="date-range-buttons">
            ${paths.map((p, i) => `<button class="date-btn ${i === 0 ? 'active' : ''}" data-path="${p}">${p}</button>`).join('')}
          </div>
          <p id="heatmap-viewport" class="heatmap-viewport">Viewport: ${clicks[0]?.viewportWidth || '?'}x${clicks[0]?.viewportHeight || '?'}</p>
          <div id="heatmap-clicks" class="heatmap-clicks"></div>
        </div>
      ` : ''

      const journeyHtml = pageviews.map((p, i) => `
        <div class="journey-step">
          <span class="journey-step-path">${p.path}</span>
          <span class="journey-step-time">${new Date(p.timestamp).toLocaleTimeString()}</span>
        </div>
        ${i < pageviews.length - 1 ? '<span class="journey-arrow">→</span>' : ''}
      `).join('')

      const getTimelineContent = (t): string => {
        switch (t.type) {
          case 'pageview':
            return `<span class="timeline-path">${t.data.path}</span>`
          case 'event':
            return `<span class="timeline-event-name">${t.data.name}</span>`
          case 'click':
            return `<span class="timeline-click-text">Click at (${t.data.viewportX}, ${t.data.viewportY}) on </span><code class="timeline-click-element">${t.data.elementTag || 'element'}</code>`
          case 'vital':
            return `<span class="timeline-vital-metric">${t.data.metric}</span>: <span class="timeline-vital-value">${t.data.value}ms (${t.data.rating})</span>`
          case 'error':
            return `<span class="timeline-error-message">${(t.data.message || '').slice(0, 100)}</span>`
          default:
            return ''
        }
      }

      const timelineHtml = timeline.map(t => `
        <div class="timeline-item">
          <span class="timeline-type ${t.type}">${t.type}</span>
          <div class="timeline-content">${getTimelineContent(t)}</div>
          <span class="timeline-time">${new Date(t.timestamp).toLocaleTimeString()}</span>
        </div>
      `).join('')

      modal.innerHTML = `
        <div class="modal-content modal-xl">
          <div class="modal-header">
            <h3 class="modal-title">Session <span id="session-id">${s.id?.slice(0, 8) || 'Unknown'}</span></h3>
            <button class="modal-close" id="close-modal-btn">&times;</button>
          </div>
          <div class="modal-body">
            <div id="session-stats" class="session-stats">${statsHtml}</div>
            ${heatmapHtml}
            <div class="session-section">
              <h4 class="session-section-title">Journey</h4>
              <div id="session-journey" class="session-journey">${journeyHtml}</div>
            </div>
            <div class="session-section">
              <h4 class="session-section-title">Timeline (<span id="timeline-count">${timeline.length}</span> events)</h4>
              <div id="session-timeline" class="session-timeline">${timelineHtml}</div>
            </div>
          </div>
        </div>
      `

      modal.classList.add('active')

      // Add event listeners
      document.getElementById('close-modal-btn')?.addEventListener('click', closeModal)
      document.querySelectorAll('#heatmap-path-buttons button').forEach(btn => {
        btn.addEventListener('click', () => window.showPathHeatmap((btn as HTMLElement).dataset.path))
      })

      // Render initial heatmap if we have clicks
      if (clicks.length > 0 && paths.length > 0) {
        renderHeatmapClicks(paths[0], clicksByPath)
      }
    }

    // Render clicks on heatmap
    function renderHeatmapClicks(path, clicksByPath) {
      const container = document.getElementById('heatmap-clicks')
      if (!container) return

      const pathClicks = clicksByPath[path] || []
      if (pathClicks.length === 0) {
        container.innerHTML = '<div class="heatmap-empty">No clicks on this page</div>'
        return
      }

      // Get viewport size from first click
      const vw = pathClicks[0].viewportWidth || 1920
      const vh = pathClicks[0].viewportHeight || 1080

      // Scale factor to fit in container
      const containerRect = container.getBoundingClientRect()
      const scale = Math.min(containerRect.width / vw, containerRect.height / vh)

      container.innerHTML = pathClicks.map(c => {
        const x = (c.viewportX || 0) * scale
        const y = (c.viewportY || 0) * scale
        return `<div style="position:absolute;left:${x}px;top:${y}px;width:20px;height:20px;background:rgba(239,68,68,0.5);border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;box-shadow:0 0 10px rgba(239,68,68,0.5)"></div>`
      }).join('')
    }

    window.showPathHeatmap = function(path) {
      if (!sessionDetail) return
      const clicks = sessionDetail.clicks || []
      const clicksByPath = {}
      for (const c of clicks) {
        const p = c.path || '/'
        if (!clicksByPath[p]) clicksByPath[p] = []
        clicksByPath[p].push(c)
      }

      // Update button states
      document.querySelectorAll('#session-modal .date-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === path)
      })

      renderHeatmapClicks(path, clicksByPath)
    }

    function closeModal() {
      const modal = document.getElementById('session-modal')
      if (modal) modal.classList.remove('active')
    }

    // Vitals state
    let perfBudgetViolations = []

    // Render vitals
    async function renderVitals() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      // Fetch performance budget violations
      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites/${siteId}/performance-budgets/check`)
        const data = await res.json()
        perfBudgetViolations = data.violations || []
      } catch (e) {
        perfBudgetViolations = []
      }

      const getRating = (v: { samples?: number; good?: number; poor?: number }) => {
        if (!v || v.samples === 0) return ''
        if ((v.good ?? 0) >= 75) return 'good'
        if ((v.poor ?? 0) >= 25) return 'poor'
        return 'needs-improvement'
      }
      const formatValue = (metric: string, value: number) => {
        if (metric === 'CLS') return (value / 1000).toFixed(3)
        return value + 'ms'
      }

      const violationsHtml = perfBudgetViolations.length > 0 ? `
        <div id="vitals-violations" class="violations-section">
          <h4 class="violations-title">Performance Budget Violations</h4>
          <div class="violations-list">
            ${perfBudgetViolations.map(v => {
              const unit = v.metric === 'CLS' ? '' : 'ms'
              return `
                <div class="violation-item">
                  <span class="violation-metric">${v.metric}</span>
                  <span class="violation-value">${v.currentValue}${unit}</span>
                  <span class="violation-exceeded">(exceeds ${v.threshold}${unit} by ${v.exceededBy}${unit})</span>
                </div>
              `
            }).join('')}
          </div>
        </div>
      ` : ''

      const vitalsHtml = vitals.map(v => {
        const rating = getRating(v)
        const value = v.samples > 0 ? formatValue(v.metric, v.p75) : '—'
        const barHtml = v.samples > 0 ? `
          <div class="vital-bar">
            <div class="good" style="width:${v.good || 0}%"></div>
            <div class="needs-improvement" style="width:${v.needsImprovement || 0}%"></div>
            <div class="poor" style="width:${v.poor || 0}%"></div>
          </div>
        ` : ''
        return `
          <div class="vital-card">
            <div class="vital-name">${v.metric}</div>
            <div class="vital-value ${rating}">${value}</div>
            <div class="vital-samples">${v.samples} samples</div>
            ${barHtml}
          </div>
        `
      }).join('')

      tabContent.innerHTML = `
        <div class="tab-panel">
          <h3 class="tab-title">Core Web Vitals</h3>
          ${violationsHtml}
          <div id="vitals-grid" class="vitals-grid">${vitalsHtml}</div>
        </div>
      `
    }

    // Error state
    let errorStatuses = {}
    let errorStatusFilter = 'all'

    // Fetch error statuses
    async function fetchErrorStatuses() {
      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites/${siteId}/errors/statuses`)
        const data = await res.json()
        errorStatuses = data.statuses || {}
      } catch (e) {
        console.error('Failed to fetch error statuses:', e)
      }
    }

    // Update error status
    async function updateErrorStatus(encodedErrorId, status, e) {
      e.preventDefault()
      e.stopPropagation()
      const errorId = decodeURIComponent(encodedErrorId)
      try {
        await fetch(`${API_ENDPOINT}/api/sites/${siteId}/errors/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ errorId, status })
        })
        errorStatuses[errorId] = { status }
        renderErrors()
      } catch (err) {
        console.error('Failed to update error status:', err)
      }
    }

    // Bulk error resolution
    async function bulkResolveErrors() {
      if (!confirm('Mark all new errors as resolved?')) return
      const newErrors = errors.filter(e => {
        const id = btoa(e.message || '').slice(0, 20)
        return !errorStatuses[id] || errorStatuses[id].status === 'new'
      })
      for (const e of newErrors) {
        const errorId = btoa(e.message || '').slice(0, 20)
        try {
          await fetch(`${API_ENDPOINT}/api/sites/${siteId}/errors/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ errorId, status: 'resolved' })
          })
          errorStatuses[errorId] = { status: 'resolved' }
        } catch (err) {
          console.error('Failed to resolve error:', err)
        }
      }
      renderErrors()
    }

    async function bulkIgnoreErrors() {
      if (!confirm('Ignore all new errors?')) return
      const newErrors = errors.filter(e => {
        const id = btoa(e.message || '').slice(0, 20)
        return !errorStatuses[id] || errorStatuses[id].status === 'new'
      })
      for (const e of newErrors) {
        const errorId = btoa(e.message || '').slice(0, 20)
        try {
          await fetch(`${API_ENDPOINT}/api/sites/${siteId}/errors/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ errorId, status: 'ignored' })
          })
          errorStatuses[errorId] = { status: 'ignored' }
        } catch (err) {
          console.error('Failed to ignore error:', err)
        }
      }
      renderErrors()
    }

    // Render errors - Ignition-style clickable error cards
    function renderErrors() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      const severityLabels: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
      const statusLabels: Record<string, string> = { new: 'New', resolved: 'Resolved', ignored: 'Ignored', regression: 'Regression' }

      function getErrorId(msg: string) {
        return btoa(msg || '').slice(0, 20)
      }

      function getErrorStatus(msg: string) {
        const id = getErrorId(msg)
        return errorStatuses[id]?.status || 'new'
      }

      const filteredErrors = errorStatusFilter === 'all'
        ? errors
        : errors.filter(e => getErrorStatus(e.message) === errorStatusFilter)

      const statusCounts: Record<string, number> = { new: 0, resolved: 0, ignored: 0 }
      errors.forEach(e => {
        const status = getErrorStatus(e.message)
        if (statusCounts[status] !== undefined) statusCounts[status]++
        else statusCounts.new++
      })

      const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 }
      filteredErrors.forEach(e => {
        if (severityCounts[e.severity] !== undefined) severityCounts[e.severity]++
      })

      const severityCardsHtml = ['critical', 'high', 'medium', 'low'].map(sev => `
        <div class="severity-card ${sev}">
          <div class="severity-card-count">${severityCounts[sev]}</div>
          <div class="severity-card-label">${severityLabels[sev]}</div>
        </div>
      `).join('')

      const emptyTitle = errorStatusFilter === 'all' ? 'No errors recorded' : `No ${errorStatusFilter} errors`
      const emptyHint = errorStatusFilter === 'all' ? 'Your application is running smoothly!' : 'Try a different filter.'

      const errorsListHtml = filteredErrors.length === 0 ? `
        <div class="empty-state">
          <p class="empty-state-title">${emptyTitle}</p>
          <p class="empty-state-hint">${emptyHint}</p>
        </div>
      ` : filteredErrors.map(e => {
        const errorId = getErrorId(e.message)
        const status = getErrorStatus(e.message)
        const severity = e.severity || 'medium'
        const classNames = ['error-card', status === 'resolved' ? 'resolved' : '', status === 'ignored' ? 'ignored' : ''].filter(Boolean).join(' ')

        const actionButtons = [
          status !== 'resolved' ? `<button class="btn btn-resolve" data-error-id="${encodeURIComponent(errorId)}" data-action="resolved">✓ Resolve</button>` : '',
          status !== 'ignored' ? `<button class="btn btn-secondary" data-error-id="${encodeURIComponent(errorId)}" data-action="ignored">Ignore</button>` : '',
          status !== 'new' ? `<button class="btn btn-secondary" data-error-id="${encodeURIComponent(errorId)}" data-action="new">Reopen</button>` : ''
        ].filter(Boolean).join('')

        return `
          <div class="error-card-wrapper">
            <a href="/errors/${encodeURIComponent(errorId)}?siteId=${siteId}" class="${classNames}">
              <div class="error-card-gradient ${severity}"></div>
              <div class="error-card-header">
                <span class="error-severity">${severityLabels[severity] || 'Unknown'}</span>
                <span class="error-category">${e.category || 'Error'}</span>
                <span class="error-status ${status}">${statusLabels[status] || 'New'}</span>
                <span class="error-count">${e.count} event${e.count !== 1 ? 's' : ''}</span>
              </div>
              <div class="error-source">${e.source ? e.source.split('/').pop() + ':' + e.line : 'Unknown source'}</div>
              <div class="error-message">${e.message || 'Unknown error'}</div>
              <div class="error-meta">
                <span class="error-first-seen">First: ${e.firstSeen ? new Date(e.firstSeen).toLocaleDateString() : 'N/A'}</span>
                <span class="error-last-seen">Last: ${new Date(e.lastSeen).toLocaleString()}</span>
                <span class="error-browsers">${(e.browsers || []).join(', ') || 'Unknown'}</span>
                <span class="error-paths">${(e.paths || []).length} page${(e.paths || []).length !== 1 ? 's' : ''}</span>
              </div>
              <div class="error-actions-inline">${actionButtons}</div>
            </a>
          </div>
        `
      }).join('')

      const bulkActionsHtml = statusCounts.new > 0 ? `
        <button id="bulk-resolve-btn" class="btn btn-secondary">Resolve All New</button>
        <button id="bulk-ignore-btn" class="btn btn-secondary">Ignore All New</button>
      ` : ''

      const filterOptions = [
        { value: 'all', label: `All (${errors.length})` },
        { value: 'new', label: `New (${statusCounts.new})` },
        { value: 'resolved', label: `Resolved (${statusCounts.resolved})` },
        { value: 'ignored', label: `Ignored (${statusCounts.ignored})` }
      ].map(opt => `<option value="${opt.value}" ${errorStatusFilter === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')

      tabContent.innerHTML = `
        <div class="tab-panel">
          <div class="errors-header">
            <h3 class="tab-title">Errors</h3>
            <div class="errors-actions">
              <select id="error-status-filter">${filterOptions}</select>
              ${bulkActionsHtml}
            </div>
          </div>
          <p id="errors-count" class="errors-count">${filteredErrors.length} error${filteredErrors.length !== 1 ? 's' : ''}</p>
          <div id="severity-summary" class="severity-summary">${severityCardsHtml}</div>
          <div id="errors-list" class="errors-list">${errorsListHtml}</div>
        </div>
      `

      // Add event listeners
      document.getElementById('error-status-filter')?.addEventListener('change', (e) => {
        errorStatusFilter = (e.target as HTMLSelectElement).value
        renderErrors()
      })
      document.getElementById('bulk-resolve-btn')?.addEventListener('click', bulkResolveErrors)
      document.getElementById('bulk-ignore-btn')?.addEventListener('click', bulkIgnoreErrors)
      tabContent.querySelectorAll('.error-actions-inline button').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          const errorId = (btn as HTMLElement).dataset.errorId
          const action = (btn as HTMLElement).dataset.action
          if (errorId && action) updateErrorStatus(errorId, action, ev)
        })
      })
    }

    // Render insights
    function renderInsights() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      const getIcon = (type: string) => {
        const icons = {
          growth: '📈', decline: '📉', warning: '⚠️', success: '✅', info: 'ℹ️'
        }
        return icons[type] || icons.info
      }

      const statsHtml = comparisonStats ? [
        { value: fmt(comparisonStats.thisWeekViews), label: 'Views This Week', change: comparisonStats.change },
        { value: fmt(comparisonStats.lastWeekViews), label: 'Views Last Week' },
        { value: String(comparisonStats.sessions || 0), label: 'Sessions' },
        { value: `${comparisonStats.bounceRate || 0}%`, label: 'Bounce Rate' }
      ].map(item => `
        <div class="insights-stat">
          <div class="insights-stat-value">${item.value}</div>
          <div class="insights-stat-label">${item.label}</div>
          ${item.change !== undefined ? `<div class="insights-stat-change ${item.change >= 0 ? 'positive' : 'negative'}">${item.change >= 0 ? '+' : ''}${item.change}%</div>` : ''}
        </div>
      `).join('') : ''

      const insightsHtml = insights.length === 0
        ? '<div class="empty-state">No insights available yet. Check back when you have more data.</div>'
        : insights.map(i => `
            <div class="insight-card">
              <div class="insight-icon ${i.severity || 'info'}">${getIcon(i.type)}</div>
              <div class="insight-content">
                <div class="insight-title">${i.title}</div>
                <div class="insight-desc">${i.description}</div>
              </div>
            </div>
          `).join('')

      tabContent.innerHTML = `
        <div class="tab-panel">
          <h3 class="tab-title">Insights</h3>
          <div id="insights-stats" class="insights-stats">${statsHtml}</div>
          <div id="insights-list" class="insights-list">${insightsHtml}</div>
        </div>
      `
    }

    // Live view state
    let liveActivities = []

    // Fetch live view
    async function fetchLiveView() {
      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites/${siteId}/live`)
        const data = await res.json()
        liveActivities = data.activities || []
        renderLiveView()

        // Auto-refresh every 5 seconds
        if (liveRefreshInterval) clearInterval(liveRefreshInterval)
        liveRefreshInterval = setInterval(async () => {
          if (activeTab === 'live') {
            const res = await fetch(`${API_ENDPOINT}/api/sites/${siteId}/live`)
            const data = await res.json()
            liveActivities = data.activities || []
            renderLiveView()
          } else {
            clearInterval(liveRefreshInterval)
          }
        }, 5000)
      } catch (e) {
        console.error('Failed to fetch live view:', e)
      }
    }

    // Render live view
    function renderLiveView() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      const activitiesHtml = liveActivities.length === 0
        ? '<div class="empty-state">No recent activity. Visitors will appear here in real-time.</div>'
        : liveActivities.map(a => `
          <div class="live-activity">
            <div class="live-activity-path">${a.path || '/'}</div>
            <div class="live-activity-meta">${a.country || 'Unknown'} • ${a.device || 'Unknown'} • ${a.browser || 'Unknown'}</div>
            <div class="live-activity-time">${timeAgo(a.timestamp)}</div>
          </div>
        `).join('')

      tabContent.innerHTML = `
        <div class="tab-panel">
          <h3 class="tab-title">Live View</h3>
          <p class="live-description">Real-time visitor activity (updates every 5 seconds)</p>
          <div id="live-activities" class="live-activities">${activitiesHtml}</div>
        </div>
      `
    }

    function timeAgo(timestamp) {
      if (!timestamp) return 'Just now'
      const time = new Date(timestamp).getTime()
      if (isNaN(time)) return 'Just now'
      const seconds = Math.floor((Date.now() - time) / 1000)
      if (seconds < 0 || isNaN(seconds)) return 'Just now'
      if (seconds < 60) return 'Just now'
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago'
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago'
      return Math.floor(seconds / 86400) + 'd ago'
    }

    // Funnels state
    let funnels = []

    // Fetch funnels
    async function fetchFunnels() {
      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites/${siteId}/funnels`)
        const data = await res.json()
        funnels = data.funnels || []
        renderFunnels()
      } catch (e) {
        console.error('Failed to fetch funnels:', e)
      }
    }

    // Render funnels
    function renderFunnels() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      const funnelsHtml = funnels.length === 0
        ? `<div class="empty-state">
            <p>No funnels configured yet.</p>
            <p class="empty-state-hint">Create a funnel to track conversion rates through your key user flows.</p>
          </div>`
        : funnels.map(f => {
          const steps = f.steps || []
          const stepsHtml = steps.map((s, i) =>
            `<span class="funnel-step">${i + 1}. ${s.name}</span>${i < steps.length - 1 ? '<span class="funnel-step-arrow">→</span>' : ''}`
          ).join('')
          return `<div class="funnel-card">
            <div class="funnel-card-header">
              <span class="funnel-name">${f.name}</span>
              <button class="btn-icon" onclick="analyzeFunnel('${f.id}')">Analyze</button>
            </div>
            <div class="funnel-steps">${stepsHtml}</div>
          </div>`
        }).join('')

      tabContent.innerHTML = `
        <div class="tab-panel">
          <div class="funnels-header">
            <h3 class="tab-title">Funnels</h3>
            <button class="btn btn-primary" onclick="showCreateFunnelModal()">+ Create Funnel</button>
          </div>
          <div id="funnels-list" class="funnels-list">${funnelsHtml}</div>
        </div>
      `
    }

    // Analyze funnel
    async function analyzeFunnel(funnelId) {
      const params = getDateRangeParams(false)
      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites/${siteId}/funnels/${funnelId}${params}`)
        const data = await res.json()
        showFunnelAnalysis(data)
      } catch (e) {
        console.error('Failed to analyze funnel:', e)
      }
    }

    function showFunnelAnalysis(data: { funnel: { name: string }, steps: any[], totalSessions: number, overallConversion: number }) {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      const { funnel, steps, totalSessions, overallConversion } = data

      const stepsHtml = steps.map((s, i) => `
        <div class="analysis-step">
          <div class="analysis-step-visitors">${s.visitors}</div>
          <div class="analysis-step-rate">${s.conversionRate}% of total</div>
          <div class="analysis-step-name">${s.name}</div>
          ${i > 0 ? `<div class="analysis-step-drop">↓ ${s.dropoffRate}% drop</div>` : ''}
        </div>
        ${i < steps.length - 1 ? '<div class="analysis-arrow">→</div>' : ''}
      `).join('')

      tabContent.innerHTML = `
        <div class="tab-panel">
          <button class="btn btn-secondary" id="back-to-funnels">← Back to Funnels</button>
          <h3 class="funnel-analysis-title">${funnel.name}</h3>
          <p class="funnel-analysis-summary">${totalSessions} sessions analyzed • ${overallConversion}% overall conversion</p>
          <div class="funnel-steps-analysis">${stepsHtml}</div>
        </div>
      `

      document.getElementById('back-to-funnels')?.addEventListener('click', () => renderFunnels())
    }

    function showCreateFunnelModal() {
      // Simple prompt-based funnel creation (could be enhanced with a modal)
      const name = prompt('Enter funnel name:')
      if (!name) return

      const stepsInput = prompt('Enter step patterns (comma-separated paths, e.g., /,/pricing,/signup):')
      if (!stepsInput) return

      const steps = stepsInput.split(',').map((pattern, i) => ({
        name: pattern.trim() || 'Step ' + (i + 1),
        type: 'pageview',
        pattern: pattern.trim()
      }))

      if (steps.length < 2) {
        alert('At least 2 steps are required')
        return
      }

      createFunnel(name, steps)
    }

    async function createFunnel(name, steps) {
      try {
        await fetch(`${API_ENDPOINT}/api/sites/${siteId}/funnels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, steps })
        })
        fetchFunnels()
      } catch (e) {
        console.error('Failed to create funnel:', e)
      }
    }

    // Settings state
    let settingsData: Record<string, any> = {}

    // Render settings
    async function renderSettings() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      // Fetch various settings
      try {
        const [retentionRes, teamRes, webhooksRes, emailReportsRes, apiKeysRes, alertsRes, uptimeRes, perfBudgetsRes] = await Promise.all([
          fetch(`${API_ENDPOINT}/api/sites/${siteId}/retention`).then(r => r.json()).catch(() => ({ retentionDays: 365 })),
          fetch(`${API_ENDPOINT}/api/sites/${siteId}/team`).then(r => r.json()).catch(() => ({ members: [] })),
          fetch(`${API_ENDPOINT}/api/sites/${siteId}/webhooks`).then(r => r.json()).catch(() => ({ webhooks: [] })),
          fetch(`${API_ENDPOINT}/api/sites/${siteId}/email-reports`).then(r => r.json()).catch(() => ({ reports: [] })),
          fetch(`${API_ENDPOINT}/api/sites/${siteId}/api-keys`).then(r => r.json()).catch(() => ({ apiKeys: [] })),
          fetch(`${API_ENDPOINT}/api/sites/${siteId}/alerts`).then(r => r.json()).catch(() => ({ alerts: [] })),
          fetch(`${API_ENDPOINT}/api/sites/${siteId}/uptime`).then(r => r.json()).catch(() => ({ monitors: [] })),
          fetch(`${API_ENDPOINT}/api/sites/${siteId}/performance-budgets`).then(r => r.json()).catch(() => ({ budgets: [] }))
        ])
        settingsData = { retention: retentionRes, team: teamRes, webhooks: webhooksRes, emailReports: emailReportsRes, apiKeys: apiKeysRes, alerts: alertsRes, uptime: uptimeRes, perfBudgets: perfBudgetsRes }
      } catch (e) {
        console.error('Failed to fetch settings:', e)
      }

      const { retention, team, webhooks, emailReports, apiKeys, alerts, uptime, perfBudgets } = settingsData

      const renderList = (items: any[], emptyText: string, renderItem: (item: any) => string): string =>
        items && items.length > 0 ? items.map(renderItem).join('') : `<div class="panel-empty">${emptyText}</div>`

      const apiKeysHtml = renderList(apiKeys?.apiKeys || [], 'No API keys yet.', k => `
        <div class="list-item">
          <span class="list-item-name">${k.name || 'API Key'}</span>
          <code class="list-item-code">${k.key}</code>
          <button class="btn-icon" data-action="delete-api-key" data-key="${k.key}">Delete</button>
        </div>
      `)

      const alertsHtml = renderList(alerts?.alerts || [], 'No alerts configured.', a => `
        <div class="list-item">
          <span class="list-item-name">${a.name}</span>
          <span class="list-item-meta">${a.type} • >${a.threshold}%</span>
          <button class="btn-icon" data-action="delete-alert" data-id="${a.id}">Delete</button>
        </div>
      `)

      const emailReportsHtml = renderList(emailReports?.reports || [], 'No email reports scheduled.', r => `
        <div class="list-item">
          <span class="list-item-name">${r.email}</span>
          <span class="list-item-meta">${r.frequency}</span>
          <button class="btn-icon" data-action="delete-email-report" data-id="${r.id}">Delete</button>
        </div>
      `)

      const uptimeHtml = renderList(uptime?.monitors || [], 'No monitors configured.', m => `
        <div class="list-item">
          <code class="list-item-code">${m.url}</code>
          <span class="list-item-meta">Every ${m.interval} min</span>
          <button class="btn-icon" data-action="delete-uptime" data-id="${m.id}">Delete</button>
        </div>
      `)

      const teamHtml = renderList(team?.members || [], 'No team members yet.', m => `
        <div class="list-item">
          <span class="list-item-name">${m.email}</span>
          <span class="list-item-role">${m.role} • ${m.status}</span>
        </div>
      `)

      const webhooksHtml = renderList(webhooks?.webhooks || [], 'No webhooks configured.', w => `
        <div class="list-item">
          <code class="list-item-code">${w.type} • ${(w.url || '').slice(0, 30)}...</code>
          <button class="btn-icon" data-action="delete-webhook" data-id="${w.id}">Delete</button>
        </div>
      `)

      const perfBudgetsHtml = renderList(perfBudgets?.budgets || [], 'No budgets configured.', b => `
        <div class="list-item">
          <span class="list-item-name">${b.metric}</span>
          <span class="list-item-meta">Max: ${b.threshold}${b.metric === 'CLS' ? '' : 'ms'}</span>
          <button class="btn-icon" data-action="delete-perf-budget" data-id="${b.id}">Delete</button>
        </div>
      `)

      const createSettingsSection = (title: string, id: string, content: string, addLabel: string, addAction: string) => `
        <div class="settings-section">
          <div class="settings-section-header">
            <h4>${title}</h4>
            <button class="btn btn-sm" data-action="${addAction}">${addLabel}</button>
          </div>
          <div id="${id}" class="settings-list">${content}</div>
        </div>
      `

      tabContent.innerHTML = `
        <div class="tab-panel settings-panel">
          <h3 class="tab-title">Settings</h3>
          <div class="settings-grid">
            ${createSettingsSection('API Keys', 'api-keys-list', apiKeysHtml, '+ Add', 'add-api-key')}
            ${createSettingsSection('Alerts', 'alerts-list', alertsHtml, '+ Add', 'add-alert')}
            ${createSettingsSection('Email Reports', 'email-reports-list', emailReportsHtml, '+ Add', 'add-email-report')}
            ${createSettingsSection('Uptime Monitoring', 'uptime-list', uptimeHtml, '+ Add', 'add-uptime')}
            ${createSettingsSection('Team Members', 'team-list', teamHtml, '+ Invite', 'invite-team')}
            ${createSettingsSection('Webhooks', 'webhooks-list', webhooksHtml, '+ Add', 'add-webhook')}
            ${createSettingsSection('Performance Budgets', 'perf-budgets-list', perfBudgetsHtml, '+ Add', 'add-perf-budget')}
            <div class="settings-section">
              <h4>Data Retention</h4>
              <p class="settings-info">Data retention period: <strong id="retention-days">${retention?.retentionDays || 365} days</strong></p>
            </div>
          </div>
        </div>
      `

      // Add event listeners using delegation
      tabContent.addEventListener('click', (e) => {
        const target = e.target as HTMLElement
        const action = target.dataset.action
        if (!action) return

        switch (action) {
          case 'add-api-key': createApiKey(); break
          case 'add-alert': createAlert(); break
          case 'add-email-report': createEmailReport(); break
          case 'add-uptime': createUptimeMonitor(); break
          case 'invite-team': inviteTeamMember(); break
          case 'add-webhook': createWebhook(); break
          case 'add-perf-budget': createPerfBudget(); break
          case 'delete-api-key': deleteApiKey(target.dataset.key); break
          case 'delete-alert': deleteAlert(target.dataset.id); break
          case 'delete-email-report': deleteEmailReport(target.dataset.id); break
          case 'delete-uptime': deleteUptimeMonitor(target.dataset.id); break
          case 'delete-webhook': deleteWebhook(target.dataset.id); break
          case 'delete-perf-budget': deletePerfBudget(target.dataset.id); break
        }
      })
    }

    // Settings action functions
    function createApiKey() {
      const name = prompt('Enter a name for this API key:')
      if (!name) return
      fetch(`${API_ENDPOINT}/api/sites/${siteId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      }).then(r => r.json()).then(data => {
        if (data.apiKey?.key) {
          alert('API Key created! Make sure to copy it now:\\n\\n' + data.apiKey.key + '\\n\\nThis key will not be shown again.')
        }
        renderSettings()
      }).catch(e => console.error(e))
    }

    function deleteApiKey(keyId) {
      if (!confirm('Delete this API key? This cannot be undone.')) return
      fetch(`${API_ENDPOINT}/api/sites/${siteId}/api-keys/${keyId}`, { method: 'DELETE' })
        .then(() => renderSettings()).catch(e => console.error(e))
    }

    function createAlert() {
      const name = prompt('Alert name:')
      if (!name) return
      const type = prompt('Alert type (traffic_spike, traffic_drop, error_rate):') || 'traffic_spike'
      const threshold = prompt('Threshold percentage (e.g., 50):') || '50'
      const email = prompt('Email for notifications (optional):')

      fetch(`${API_ENDPOINT}/api/sites/${siteId}/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, threshold: parseInt(threshold), email })
      }).then(() => renderSettings()).catch(e => console.error(e))
    }

    function deleteAlert(alertId) {
      if (!confirm('Delete this alert?')) return
      fetch(`${API_ENDPOINT}/api/sites/${siteId}/alerts/${alertId}`, { method: 'DELETE' })
        .then(() => renderSettings()).catch(e => console.error(e))
    }

    function createUptimeMonitor() {
      const url = prompt('URL to monitor (e.g., https://example.com/api/health):')
      if (!url) return
      const interval = prompt('Check interval in minutes (default: 5):') || '5'

      fetch(`${API_ENDPOINT}/api/sites/${siteId}/uptime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, interval: parseInt(interval) })
      }).then(() => renderSettings()).catch(e => console.error(e))
    }

    function deleteUptimeMonitor(monitorId) {
      if (!confirm('Delete this monitor?')) return
      fetch(`${API_ENDPOINT}/api/sites/${siteId}/uptime/${monitorId}`, { method: 'DELETE' })
        .then(() => renderSettings()).catch(e => console.error(e))
    }

    function createPerfBudget() {
      const metric = prompt('Metric (LCP, FID, CLS, TTFB, INP, FCP):')
      if (!metric) return
      const threshold = prompt(`Threshold value (${metric === 'CLS' ? 'e.g., 0.1' : 'e.g., 2500ms'}):`)
      if (!threshold) return
      const email = prompt('Email for alerts (optional):')

      fetch(`${API_ENDPOINT}/api/sites/${siteId}/performance-budgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric: metric.toUpperCase(), threshold: parseFloat(threshold), alertEmail: email })
      }).then(() => renderSettings()).catch(e => console.error(e))
    }

    function deletePerfBudget(budgetId) {
      if (!confirm('Delete this performance budget?')) return
      fetch(`${API_ENDPOINT}/api/sites/${siteId}/performance-budgets/${budgetId}`, { method: 'DELETE' })
        .then(() => renderSettings()).catch(e => console.error(e))
    }

    async function updateRetention(days) {
      try {
        await fetch(`${API_ENDPOINT}/api/sites/${siteId}/retention`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retentionDays: parseInt(days) })
        })
      } catch (e) {
        console.error('Failed to update retention:', e)
      }
    }

    function inviteTeamMember() {
      const email = prompt('Enter email address:')
      if (!email) return
      const role = prompt('Enter role (admin, editor, viewer):') || 'viewer'

      fetch(`${API_ENDPOINT}/api/sites/${siteId}/team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role })
      }).then(() => renderSettings()).catch(e => console.error(e))
    }

    function addWebhook() {
      const type = prompt('Enter type (slack, discord):')
      if (!type) return
      const url = prompt('Enter webhook URL:')
      if (!url) return

      fetch(`${API_ENDPOINT}/api/sites/${siteId}/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, url, events: ['alert', 'goal'] })
      }).then(() => renderSettings()).catch(e => console.error(e))
    }

    function deleteWebhook(webhookId) {
      if (!confirm('Delete this webhook?')) return
      fetch(`${API_ENDPOINT}/api/sites/${siteId}/webhooks/${webhookId}`, { method: 'DELETE' })
        .then(() => renderSettings()).catch(e => console.error(e))
    }

    function addEmailReport() {
      const email = prompt('Enter email address:')
      if (!email) return
      const frequency = prompt('Enter frequency (daily, weekly, monthly):') || 'weekly'

      fetch(`${API_ENDPOINT}/api/sites/${siteId}/email-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, frequency })
      }).then(() => renderSettings()).catch(e => console.error(e))
    }

    function deleteEmailReport(reportId) {
      if (!confirm('Delete this email report?')) return
      fetch(`${API_ENDPOINT}/api/sites/${siteId}/email-reports/${reportId}`, { method: 'DELETE' })
        .then(() => renderSettings()).catch(e => console.error(e))
    }

    function gdprExport() {
      const visitorId = prompt('Enter visitor ID to export:')
      if (!visitorId) return
      window.open(`${API_ENDPOINT}/api/sites/${siteId}/gdpr/export?visitorId=${visitorId}`, '_blank')
    }

    function gdprDelete() {
      const visitorId = prompt('Enter visitor ID to delete:')
      if (!visitorId) return
      if (!confirm('This will permanently delete all data for this visitor. Continue?')) return

      fetch(`${API_ENDPOINT}/api/sites/${siteId}/gdpr/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, confirmDelete: true })
      }).then(r => r.json()).then(data => {
        alert('Deleted ' + data.deletedRecords + ' records')
      }).catch(e => console.error(e))
    }

    // Apply filter
    function applyFilter(type, value) {
      filters[type] = value
      if (activeTab === 'sessions') {
        fetchSessions()
      } else {
        fetchDashboardData()
      }
    }

    // Update filter dropdowns with data
    function updateFilters() {
      const countrySelect = document.getElementById('filter-country') as HTMLSelectElement
      const browserSelect = document.getElementById('filter-browser') as HTMLSelectElement

      if (countrySelect && countries.length > 0) {
        clear(countrySelect)
        countrySelect.appendChild(el('option', { value: '' }, 'All Countries'))
        for (const c of countries.slice(0, 20)) {
          const value = c.country || c.name
          countrySelect.appendChild(el('option', { value }, value))
        }
      }

      if (browserSelect && browsers.length > 0) {
        clear(browserSelect)
        browserSelect.appendChild(el('option', { value: '' }, 'All Browsers'))
        for (const b of browsers.slice(0, 10)) {
          const value = b.browser || b.name
          browserSelect.appendChild(el('option', { value }, value))
        }
      }
    }

    // Export data
    async function exportData(format) {
      const params = getDateRangeParams(false)
      const type = activeTab === 'sessions' ? 'sessions' : activeTab === 'events' ? 'events' : 'pageviews'
      const url = `${API_ENDPOINT}/api/sites/${siteId}/export${params}&format=${format}&type=${type}`
      if (format === 'csv') {
        window.open(url, '_blank')
      } else {
        try {
          const res = await fetch(url)
          const data = await res.json()
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = type + '-export.json'
          a.click()
        } catch (e) {
          console.error('Export failed:', e)
        }
      }
    }

    function hasAnyData() {
      return stats.views > 0 || stats.sessions > 0 || stats.people > 0 || pages.length > 0
    }

    function renderDashboard(animate = false) {
      const duration = 600 // Animation duration in ms

      // Helper to render comparison badge
      function compBadge(change) {
        if (!showComparison || !comparisonData || change === undefined) return ''
        const isUp = change > 0
        const color = isUp ? '#22c55e' : '#ef4444'
        const arrow = isUp ? '↑' : '↓'
        return '<span style="font-size:0.6875rem;color:' + color + ';margin-left:4px">' + arrow + Math.abs(change) + '%</span>'
      }

      // Update stats with animation
      if (animate && previousStats) {
        animateValue(document.getElementById('stat-realtime'), previousStats.realtime, stats.realtime, duration, fmt)
        animateValue(document.getElementById('stat-sessions'), previousStats.sessions, stats.sessions, duration, fmt)
        animateValue(document.getElementById('stat-people'), previousStats.people, stats.people, duration, fmt)
        animateValue(document.getElementById('stat-views'), previousStats.views, stats.views, duration, fmt)
        animateValue(document.getElementById('stat-bounce'), previousStats.bounceRate, stats.bounceRate, duration, v => v + '%')
        document.getElementById('stat-avgtime').textContent = stats.avgTime
      } else {
        document.getElementById('stat-realtime').textContent = fmt(stats.realtime)
        setStatValue('stat-sessions', fmt(stats.sessions), comparisonData?.changes?.sessions)
        setStatValue('stat-people', fmt(stats.people), comparisonData?.changes?.visitors)
        setStatValue('stat-views', fmt(stats.views), comparisonData?.changes?.pageviews)
        setStatValue('stat-bounce', stats.bounceRate + '%', comparisonData?.changes?.bounceRate)
        setStatValue('stat-avgtime', stats.avgTime, comparisonData?.changes?.avgDuration)
      }
      document.getElementById('realtime-count').textContent = stats.realtime === 1 ? '1 visitor online' : stats.realtime + ' visitors online'

      // Update filter dropdowns
      updateFilters()

      // Update last updated time
      if (lastUpdated) {
        document.getElementById('last-updated').textContent = 'Updated ' + lastUpdated.toLocaleTimeString()
      }

      // Show setup instructions if no data
      const noDataMsg = document.getElementById('no-data-msg')
      const mainContent = document.getElementById('main-content')

      // Only show setup instructions for truly new sites (no historical data)
      // If site has historical data but current time range is empty, just show empty charts
      if (!hasAnyData() && !siteHasHistoricalData) {
        noDataMsg.style.display = 'block'
        mainContent.style.display = 'none'
        document.getElementById('tracking-script').textContent = '<script src="' + API_ENDPOINT + '/sites/' + siteId + '/script" defer></' + 'script>'
        return
      }

      noDataMsg.style.display = 'none'
      mainContent.style.display = 'block'

      // Note: Table panels are now self-contained STX components that handle their own rendering.
      // The panel components (PagesPanel, ReferrersPanel, etc.) fetch and render data independently.
      // See: src/views/components/dashboard/*Panel.stx

      renderChart()
    }

    function showCreateGoalModal() {
      editingGoal = null
      document.getElementById('goal-modal-title').textContent = 'Create Goal'
      document.getElementById('goal-form').reset()
      document.getElementById('goal-modal').style.display = 'flex'
      updateGoalForm()
    }

    function editGoal(goalId) {
      const goal = goals.find(g => g.id === goalId)
      if (!goal) return

      editingGoal = goal
      document.getElementById('goal-modal-title').textContent = 'Edit Goal'
      document.getElementById('goal-name').value = goal.name || ''
      document.getElementById('goal-type').value = goal.type || 'pageview'
      document.getElementById('goal-pattern').value = goal.pattern || ''
      document.getElementById('goal-match-type').value = goal.matchType || 'exact'
      document.getElementById('goal-duration').value = goal.durationMinutes || 5
      document.getElementById('goal-value').value = goal.value || ''
      document.getElementById('goal-modal').style.display = 'flex'
      updateGoalForm()
    }

    function updateGoalForm() {
      const type = document.getElementById('goal-type').value
      document.getElementById('goal-pattern-group').style.display = type !== 'duration' ? 'block' : 'none'
      document.getElementById('goal-duration-group').style.display = type === 'duration' ? 'block' : 'none'
    }

    function closeGoalModal() {
      document.getElementById('goal-modal').style.display = 'none'
      editingGoal = null
    }

    async function saveGoal(e) {
      e.preventDefault()

      const type = document.getElementById('goal-type').value
      const data = {
        name: document.getElementById('goal-name').value,
        type,
        pattern: type !== 'duration' ? document.getElementById('goal-pattern').value : '',
        matchType: type !== 'duration' ? document.getElementById('goal-match-type').value : 'exact',
        durationMinutes: type === 'duration' ? Number(document.getElementById('goal-duration').value) : undefined,
        value: document.getElementById('goal-value').value ? Number(document.getElementById('goal-value').value) : undefined,
        isActive: true,
      }

      const url = editingGoal
        ? `${API_ENDPOINT}/api/sites/${siteId}/goals/${editingGoal.id}`
        : `${API_ENDPOINT}/api/sites/${siteId}/goals`
      const method = editingGoal ? 'PUT' : 'POST'

      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        })
        if (res.ok) {
          closeGoalModal()
          fetchDashboardData()
        } else {
          const err = await res.json()
          alert(err.error || 'Failed to save goal')
        }
      } catch (err) {
        console.error('Save goal error:', err)
        alert('Failed to save goal')
      }
    }

    async function deleteGoal(goalId) {
      if (!confirm('Delete this goal? Conversion data will be preserved.')) return

      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites/${siteId}/goals/${goalId}`, { method: 'DELETE' })
        if (res.ok) {
          fetchDashboardData()
        }
      } catch (err) {
        console.error('Delete goal error:', err)
      }
    }

    function renderChart() {
      const canvas = document.getElementById('chart')
      const chartEmpty = document.getElementById('chart-empty')
      const tooltip = document.getElementById('chartTooltip')

      if (!canvas) return

      // Read CSS variables for theme-aware chart colors
      const styles = getComputedStyle(document.documentElement)
      const colors = {
        border: styles.getPropertyValue('--border').trim() || '#2d3139',
        accent2: styles.getPropertyValue('--accent2').trim() || '#818cf8',
        muted: styles.getPropertyValue('--muted').trim() || '#6b7280',
        text: styles.getPropertyValue('--text').trim() || '#f3f4f6'
      }

      if (!timeSeriesData.length) {
        canvas.style.display = 'none'
        chartEmpty.style.display = 'flex'
        return
      }

      canvas.style.display = 'block'
      chartEmpty.style.display = 'none'

      const ctx = canvas.getContext('2d')
      const rect = canvas.parentElement.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const logicalW = rect.width - 48
      const logicalH = 220
      canvas.width = logicalW * dpr
      canvas.height = logicalH * dpr
      canvas.style.width = logicalW + 'px'
      canvas.style.height = logicalH + 'px'
      ctx.scale(dpr, dpr)
      const pad = { top: 20, right: 20, bottom: 50, left: 50 }
      const w = logicalW - pad.left - pad.right
      const h = logicalH - pad.top - pad.bottom
      const maxV = Math.max(...timeSeriesData.map(d => d.views || d.count || 0), 1)
      const xS = w / (timeSeriesData.length - 1 || 1)
      const yS = h / maxV

      // Store points for hover
      const points = timeSeriesData.map((d, i) => ({
        x: pad.left + i * xS,
        y: pad.top + h - (d.views || d.count || 0) * yS,
        data: d
      }))

      function fmtDate(dateStr) {
        if (!dateStr) return '-'
        const date = new Date(dateStr)
        if (isNaN(date.getTime())) return String(dateStr)
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        // Show time for hourly ranges, date for daily ranges
        if (dateRange === '1h' || dateRange === '6h' || dateRange === '12h') {
          const h = date.getHours()
          const m = date.getMinutes()
          const ampm = h >= 12 ? 'pm' : 'am'
          const h12 = h % 12 || 12
          return h12 + ':' + (m < 10 ? '0' : '') + m + ampm
        } else if (dateRange === '24h') {
          const h = date.getHours()
          const ampm = h >= 12 ? 'pm' : 'am'
          const h12 = h % 12 || 12
          return h12 + ampm
        }
        return months[date.getMonth()] + ' ' + date.getDate()
      }

      function fmtDateFull(dateStr) {
        if (!dateStr) return '-'
        const date = new Date(dateStr)
        if (isNaN(date.getTime())) return String(dateStr)
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        const h = date.getHours()
        const m = date.getMinutes()
        const ampm = h >= 12 ? 'pm' : 'am'
        const h12 = h % 12 || 12
        const timeStr = h12 + ':' + (m < 10 ? '0' : '') + m + ampm
        const dateStr2 = months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear()
        if (dateRange === '1h' || dateRange === '6h' || dateRange === '12h' || dateRange === '24h') {
          return dateStr2 + ' at ' + timeStr
        }
        return dateStr2
      }

      function draw(hoverIdx) {
        ctx.save()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, logicalW, logicalH)

        // Grid lines
        ctx.strokeStyle = colors.border
        ctx.lineWidth = 1
        for (let i = 0; i <= 4; i++) {
          const y = pad.top + (h/4)*i
          ctx.beginPath()
          ctx.moveTo(pad.left, y)
          ctx.lineTo(pad.left+w, y)
          ctx.stroke()
        }

        // Fill
        ctx.beginPath()
        ctx.fillStyle = colors.accent2 + '1a' // 0.1 alpha
        points.forEach((p, i) => {
          i===0 ? (ctx.moveTo(p.x,pad.top+h), ctx.lineTo(p.x,p.y)) : ctx.lineTo(p.x,p.y)
        })
        ctx.lineTo(points[points.length-1].x, pad.top+h)
        ctx.closePath()
        ctx.fill()

        // Line
        ctx.beginPath()
        ctx.strokeStyle = colors.accent2
        ctx.lineWidth = 2
        points.forEach((p, i) => { i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y) })
        ctx.stroke()

        // Data points
        points.forEach((p, i) => {
          ctx.beginPath()
          ctx.fillStyle = i === hoverIdx ? colors.text : colors.accent2
          ctx.arc(p.x, p.y, i === hoverIdx ? 6 : 3, 0, Math.PI * 2)
          ctx.fill()
          if (i === hoverIdx) { ctx.strokeStyle = colors.accent2; ctx.lineWidth = 2; ctx.stroke() }
        })

        // Annotation markers
        const annotationColors = { deployment: '#22c55e', campaign: '#3b82f6', incident: '#ef4444', general: '#8b5cf6' }
        if (annotations.length > 0) {
          annotations.forEach(ann => {
            // Find the x position for this annotation date
            const annDate = new Date(ann.date).toISOString().split('T')[0]
            const idx = timeSeriesData.findIndex(d => {
              const tDate = new Date(d.date).toISOString().split('T')[0]
              return tDate === annDate
            })
            if (idx >= 0 && idx < points.length) {
              const px = points[idx].x
              const color = annotationColors[ann.type] || annotationColors.general
              // Draw vertical line
              ctx.beginPath()
              ctx.strokeStyle = color
              ctx.lineWidth = 2
              ctx.setLineDash([4, 2])
              ctx.moveTo(px, pad.top)
              ctx.lineTo(px, pad.top + h)
              ctx.stroke()
              ctx.setLineDash([])
              // Draw marker circle at top
              ctx.beginPath()
              ctx.fillStyle = color
              ctx.arc(px, pad.top - 8, 5, 0, Math.PI * 2)
              ctx.fill()
              // Draw tiny icon based on type
              ctx.fillStyle = 'white'
              ctx.font = '8px sans-serif'
              ctx.textAlign = 'center'
              const icons = { deployment: '↑', campaign: '📢', incident: '!', general: '•' }
              ctx.fillText(icons[ann.type] || '•', px, pad.top - 5)
            }
          })
        }

        // Y-axis labels
        ctx.fillStyle = colors.muted
        ctx.font = '11px -apple-system, sans-serif'
        ctx.textAlign = 'right'
        for (let i = 0; i <= 4; i++) {
          ctx.fillText(fmt(Math.round(maxV - (maxV/4)*i)), pad.left-10, pad.top+(h/4)*i+4)
        }

        // X-axis labels - smart distribution based on data length
        ctx.textAlign = 'center'
        const n = timeSeriesData.length
        let maxLabels = 7
        // Adjust label count based on time range
        if (dateRange === '1h') maxLabels = Math.min(n, 7) // 5-min buckets, show ~7 labels
        else if (dateRange === '6h') maxLabels = Math.min(n, 7)
        else if (dateRange === '12h') maxLabels = Math.min(n, 7)
        else if (dateRange === '24h') maxLabels = Math.min(n, 8)

        if (n === 1) {
          // Single data point: show just that label centered
          ctx.fillText(fmtDate(timeSeriesData[0].date), pad.left + w / 2, logicalH - 10)
        } else if (n <= maxLabels) {
          // Few points: show all labels
          timeSeriesData.forEach((d, i) => {
            ctx.fillText(fmtDate(d.date), pad.left + i * xS, logicalH - 10)
          })
        } else {
          // Many points: distribute labels evenly
          const step = (n - 1) / (maxLabels - 1)
          for (let j = 0; j < maxLabels; j++) {
            const i = Math.round(j * step)
            const d = timeSeriesData[i]
            ctx.fillText(fmtDate(d.date), pad.left + i * xS, logicalH - 10)
          }
        }

        // Hover line
        if (hoverIdx >= 0) {
          ctx.beginPath()
          ctx.strokeStyle = colors.accent2 + '80' // 0.5 alpha
          ctx.lineWidth = 1
          ctx.setLineDash([4, 4])
          ctx.moveTo(points[hoverIdx].x, pad.top)
          ctx.lineTo(points[hoverIdx].x, pad.top + h)
          ctx.stroke()
          ctx.setLineDash([])
        }
        ctx.restore()
      }

      draw(-1)

      // Get or create tooltip inner elements
      const tooltipDate = tooltip.querySelector('.tooltip-date') || (() => {
        const d = document.createElement('div'); d.className = 'tooltip-date'; tooltip.appendChild(d); return d
      })()
      const tooltipViews = tooltip.querySelector('.tooltip-views') || (() => {
        const d = document.createElement('div'); d.className = 'tooltip-row'
        d.innerHTML = '<span class="tooltip-dot views"></span>Views: <strong class="tooltip-views"></strong>'
        tooltip.appendChild(d); return d.querySelector('.tooltip-views')
      })()
      const tooltipVisitors = tooltip.querySelector('.tooltip-visitors') || (() => {
        const d = document.createElement('div'); d.className = 'tooltip-row'
        d.innerHTML = '<span class="tooltip-dot visitors"></span>Visitors: <strong class="tooltip-visitors"></strong>'
        tooltip.appendChild(d); return d.querySelector('.tooltip-visitors')
      })()

      canvas.onmousemove = function(e) {
        const cr = canvas.getBoundingClientRect()
        const mx = e.clientX - cr.left
        let closest = -1, minDist = 30
        points.forEach((p, i) => { const d = Math.abs(mx - p.x); if (d < minDist) { minDist = d; closest = i } })
        if (closest >= 0) {
          const p = points[closest], d = p.data
          tooltipDate.textContent = fmtDateFull(d.date)
          tooltipViews.textContent = fmt(d.views || d.count || 0)
          tooltipVisitors.textContent = fmt(d.visitors || 0)
          tooltip.style.display = 'block'
          let left = p.x + 10; if (left + 150 > logicalW) left = p.x - 160
          tooltip.style.left = left + 'px'
          tooltip.style.top = (p.y - 20) + 'px'
          draw(closest)
          canvas.style.cursor = 'pointer'
        } else {
          tooltip.style.display = 'none'
          draw(-1)
          canvas.style.cursor = 'default'
        }
      }
      canvas.onmouseleave = function() { tooltip.style.display = 'none'; draw(-1) }
    }

    // Handle browser back/forward navigation
    window.addEventListener('popstate', (event) => {
      if (event.state && event.state.tab) {
        switchTab(event.state.tab, false) // Don't update history on popstate
      } else if (event.state && event.state.siteId) {
        // Handle site selection from history
        const tab = getTabFromUrl()
        switchTab(tab, false)
      } else if (!siteId) {
        // Going back to site selector
        goBack()
      }
    })

    document.addEventListener('DOMContentLoaded', async () => {
      if (siteId) {
        currentSite = { id: siteId }
        document.getElementById('site-selector').style.display = 'none'
        document.getElementById('dashboard').style.display = 'block'

        // Load and display cached stats immediately before fetching
        const cached = loadCachedStats()
        if (cached) {
          stats = cached
          previousStats = null
          renderDashboard(false)
        }

        // Handle initial tab from URL (e.g., /dashboard/sessions?siteId=xxx)
        const initialTab = getTabFromUrl()

        // Wait for data to load before switching to non-dashboard tabs
        await fetchDashboardData()
        refreshInterval = setInterval(fetchDashboardData, 30000)

        if (initialTab !== 'dashboard') {
          switchTab(initialTab, false) // Don't push to history on initial load
        }
        // Replace current history entry with proper state
        updateUrlForTab(initialTab, true)
      } else {
        document.getElementById('site-selector').style.display = 'flex'
        document.getElementById('dashboard').style.display = 'none'
        fetchSites()
      }
    })

    window.addEventListener('resize', () => { if (timeSeriesData.length) renderChart() })

    // Expose functions to global scope for onclick handlers
    Object.assign(window, {
      selectSite,
      fetchSites,
      createSite,
      goBack,
      toggleTheme,
      setDateRange,
      applyFilters,
      clearFilters,
      switchTab,
      navigateTo,
      showCreateGoalModal,
      closeModal,
      closeGoalModal,
      saveGoal,
      updateGoalForm,
      createGoal,
      editGoal,
      deleteGoal,
      viewSession,
      analyzeFunnel,
      fetchFunnels,
      showCreateFunnelModal,
      createAlert,
      deleteAlert,
      addEmailReport,
      deleteEmailReport,
      createApiKey,
      deleteApiKey,
      createPerfBudget,
      deletePerfBudget,
      createUptimeMonitor,
      deleteUptimeMonitor,
      addWebhook,
      deleteWebhook,
      inviteTeamMember,
      gdprExport,
      gdprDelete,
      updateErrorStatus,
      bulkResolveErrors,
      bulkIgnoreErrors,
      renderErrors,
      showPathHeatmap,
      addAnnotation,
      toggleComparison,
      applyFilter,
      fetchDashboardData,
      exportData,
    })

