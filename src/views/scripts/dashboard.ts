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
      const loadingTemplate = document.getElementById('site-selector-loading-template') as HTMLTemplateElement
      if (loadingTemplate) {
        container.innerHTML = ''
        container.appendChild(loadingTemplate.content.cloneNode(true))
      }
      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites`)
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        availableSites = data.sites || []
        renderSiteSelector()
      } catch (err) {
        const errorTemplate = document.getElementById('site-selector-error-template') as HTMLTemplateElement
        if (errorTemplate) {
          container.innerHTML = ''
          container.appendChild(errorTemplate.content.cloneNode(true))
        }
      }
    }

    function renderSiteSelector() {
      const container = document.getElementById('site-list')

      // Always show create site form at top
      const createForm = `<div class="create-site-form" style="margin-bottom:1.5rem;width:100%;max-width:500px">
        <h3 style="font-size:0.875rem;margin-bottom:0.75rem;color:var(--text2)">Create New Site</h3>
        <form onsubmit="createSite(event)" style="display:flex;gap:0.5rem">
          <input type="text" id="new-site-name" placeholder="Site name (e.g. My Website)" required style="flex:1;padding:0.5rem 0.75rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:0.875rem">
          <input type="text" id="new-site-domain" placeholder="Domain (optional)" style="flex:1;padding:0.5rem 0.75rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:0.875rem">
          <button type="submit" style="padding:0.5rem 1rem;border-radius:6px;background:var(--accent);color:white;border:none;cursor:pointer;font-weight:500">Create</button>
        </form>
        <p id="create-site-error" style="color:var(--error);font-size:0.75rem;margin-top:0.5rem;display:none"></p>
      </div>`

      if (availableSites.length === 0) {
        container.innerHTML = createForm + `<div class="empty" style="margin-top:1rem">
          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          <p>No sites yet</p>
          <p style="font-size:0.75rem;margin-top:0.5rem;color:var(--muted)">Create your first site above to start tracking analytics</p>
        </div>`
        return
      }

      container.innerHTML = createForm + `<h3 style="font-size:0.875rem;margin-bottom:0.75rem;color:var(--text2);width:100%;max-width:500px">Your Sites</h3>` + availableSites.map(s =>
        `<button class="site-card" onclick="selectSite('${s.id}', '${(s.name || '').replace(/'/g, "\\\\'")}')">
          <div class="site-icon"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg></div>
          <div class="site-info"><span class="site-name">${s.name || 'Unnamed'}</span><span class="site-domain">${s.domains?.[0] || s.id}</span></div>
          <svg class="arrow" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
        </button>`
      ).join('')
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
      if (refreshInterval) clearInterval(refreshInterval)
      refreshInterval = setInterval(fetchDashboardData, 30000)
    }

    function goBack() {
      if (refreshInterval) clearInterval(refreshInterval)
      siteId = ''
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
    }

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

    // Helper function to render table rows from templates
    function renderTableRows<T>(
      tbodyId: string,
      data: T[],
      templateId: string,
      emptyColspan: number,
      emptyText: string,
      populateRow: (row: DocumentFragment, item: T) => void
    ) {
      const tbody = document.getElementById(tbodyId)
      if (!tbody) return

      if (!data.length) {
        const emptyTemplate = document.getElementById(`empty-row-${emptyColspan}-template`) as HTMLTemplateElement
        if (emptyTemplate) {
          const emptyRow = emptyTemplate.content.cloneNode(true) as DocumentFragment
          const td = emptyRow.querySelector('.empty-cell')
          if (td) td.textContent = emptyText
          tbody.innerHTML = ''
          tbody.appendChild(emptyRow)
        } else {
          tbody.innerHTML = `<tr><td colspan="${emptyColspan}" class="empty-cell">${emptyText}</td></tr>`
        }
        return
      }

      const template = document.getElementById(templateId) as HTMLTemplateElement
      if (!template) return

      tbody.innerHTML = ''
      data.forEach(item => {
        const row = template.content.cloneNode(true) as DocumentFragment
        populateRow(row, item)
        tbody.appendChild(row)
      })
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
      const params = getDateRangeParams(false)
      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites/${siteId}/flow${params}`)
        flowData = await res.json()
        renderUserFlow()
      } catch (e) {
        console.error('Failed to fetch user flow:', e)
      }
    }

    // Render user flow visualization
    function renderUserFlow() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent || !flowData) return

      const { nodes, links, totalSessions, analyzedSessions } = flowData
      const entryNodes = nodes.filter(n => n.id === '/' || links.every(l => l.target !== n.id || l.source === n.id))

      const template = document.getElementById('flow-tab-template') as HTMLTemplateElement
      if (!template) return
      const clone = template.content.cloneNode(true) as DocumentFragment

      // Set summary
      const summaryEl = clone.querySelector('#flow-summary')
      if (summaryEl) summaryEl.textContent = `Showing top paths from ${analyzedSessions} of ${totalSessions} multi-page sessions`

      // Build entry nodes
      const entryContainer = clone.querySelector('#flow-entry .flow-nodes') as HTMLElement
      const nodeTemplate = document.getElementById('flow-node-template') as HTMLTemplateElement
      if (entryContainer && nodeTemplate) {
        entryNodes.slice(0, 8).forEach(n => {
          const node = nodeTemplate.content.cloneNode(true) as DocumentFragment
          const pathEl = node.querySelector('.flow-node-path')
          const countEl = node.querySelector('.flow-node-count')
          if (pathEl) pathEl.textContent = n.id
          if (countEl) countEl.textContent = `${n.count} visits`
          entryContainer.appendChild(node)
        })
      }

      // Build flow links
      const linksContainer = clone.querySelector('#flow-links .flow-connections') as HTMLElement
      const linkTemplate = document.getElementById('flow-link-template') as HTMLTemplateElement
      if (linksContainer && linkTemplate) {
        links.slice(0, 15).forEach(l => {
          const link = linkTemplate.content.cloneNode(true) as DocumentFragment
          const sourceEl = link.querySelector('.flow-link-source')
          const targetEl = link.querySelector('.flow-link-target')
          const countEl = link.querySelector('.flow-link-count')
          if (sourceEl) sourceEl.textContent = l.source
          if (targetEl) targetEl.textContent = l.target
          if (countEl) countEl.textContent = `${l.value}x`
          linksContainer.appendChild(link)
        })
      }

      // Build top visited
      const visitedContainer = clone.querySelector('#flow-visited .flow-ranks') as HTMLElement
      const rankTemplate = document.getElementById('flow-rank-template') as HTMLTemplateElement
      if (visitedContainer && rankTemplate) {
        nodes.slice(0, 10).forEach((n, i) => {
          const rank = rankTemplate.content.cloneNode(true) as DocumentFragment
          const numEl = rank.querySelector('.flow-rank-number')
          const pathEl = rank.querySelector('.flow-rank-path')
          const countEl = rank.querySelector('.flow-rank-count')
          if (numEl) numEl.textContent = String(i + 1)
          if (pathEl) pathEl.textContent = n.id
          if (countEl) countEl.textContent = String(n.count)
          visitedContainer.appendChild(rank)
        })
      }

      // Show empty state if no links
      const emptyEl = clone.querySelector('#flow-empty') as HTMLElement
      if (emptyEl && links.length === 0) {
        emptyEl.style.display = 'block'
      }

      tabContent.innerHTML = ''
      tabContent.appendChild(clone)
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

    // Render sessions list using template
    function renderSessions() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      const template = document.getElementById('sessions-tab-template') as HTMLTemplateElement
      if (!template) return

      const clone = template.content.cloneNode(true) as DocumentFragment
      const countEl = clone.querySelector('#sessions-count')
      const listEl = clone.querySelector('#sessions-list')

      if (countEl) countEl.textContent = String(sessions.length)
      if (!listEl) return

      if (sessions.length === 0) {
        const emptyTemplate = document.getElementById('sessions-empty-template') as HTMLTemplateElement
        if (emptyTemplate) {
          listEl.innerHTML = ''
          listEl.appendChild(emptyTemplate.content.cloneNode(true))
        }
      } else {
        const cardTemplate = document.getElementById('session-card-template') as HTMLTemplateElement
        if (!cardTemplate) return

        listEl.innerHTML = ''
        sessions.forEach(s => {
          const card = cardTemplate.content.cloneNode(true) as DocumentFragment
          const cardEl = card.querySelector('.session-card') as HTMLElement
          const pathEl = card.querySelector('.session-path')
          const timeEl = card.querySelector('.session-time')
          const pagesEl = card.querySelector('.session-pages')
          const durationEl = card.querySelector('.session-duration')
          const browserEl = card.querySelector('.session-browser')
          const countryEl = card.querySelector('.session-country')
          const metaEl = card.querySelector('.session-card-meta')

          if (cardEl) cardEl.setAttribute('onclick', `viewSession('${s.id}')`)
          if (pathEl) pathEl.textContent = s.entryPath || '/'
          if (timeEl) timeEl.textContent = new Date(s.startedAt).toLocaleString()
          if (pagesEl) pagesEl.textContent = `${s.pageViewCount || 0} pages`
          if (durationEl) durationEl.textContent = formatDuration(s.duration)
          if (browserEl) browserEl.textContent = s.browser || 'Unknown'
          if (countryEl) countryEl.textContent = s.country || 'Unknown'
          if (s.isBounce && metaEl) {
            const bounced = document.createElement('span')
            bounced.className = 'bounced'
            bounced.textContent = 'Bounced'
            metaEl.appendChild(bounced)
          }

          listEl.appendChild(card)
        })
      }

      tabContent.innerHTML = ''
      tabContent.appendChild(clone)
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
      let modal = document.getElementById('session-modal')
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

      const template = document.getElementById('session-modal-template') as HTMLTemplateElement
      if (!template) return
      const clone = template.content.cloneNode(true) as DocumentFragment

      // Session ID
      const idEl = clone.querySelector('#session-id')
      if (idEl) idEl.textContent = s.id?.slice(0, 8) || 'Unknown'

      // Stats
      const statsEl = clone.querySelector('#session-stats') as HTMLElement
      const statTemplate = document.getElementById('session-stat-template') as HTMLTemplateElement
      if (statsEl && statTemplate) {
        const statItems = [
          { value: String(s.pageViewCount || 0), label: 'Pages' },
          { value: formatDuration(s.duration), label: 'Duration' },
          { value: s.browser || '?', label: 'Browser' },
          { value: s.country || '?', label: 'Country' }
        ]
        statItems.forEach(item => {
          const stat = statTemplate.content.cloneNode(true) as DocumentFragment
          const valueEl = stat.querySelector('.session-stat-value')
          const labelEl = stat.querySelector('.session-stat-label')
          if (valueEl) valueEl.textContent = item.value
          if (labelEl) labelEl.textContent = item.label
          statsEl.appendChild(stat)
        })
      }

      // Heatmap section
      if (clicks.length > 0) {
        const heatmapSection = clone.querySelector('#session-heatmap-section') as HTMLElement
        if (heatmapSection) {
          heatmapSection.style.display = 'block'
          const clicksCount = clone.querySelector('#clicks-count')
          if (clicksCount) clicksCount.textContent = String(clicks.length)

          const buttonsEl = clone.querySelector('#heatmap-path-buttons') as HTMLElement
          if (buttonsEl) {
            paths.forEach((p, i) => {
              const btn = document.createElement('button')
              btn.className = `date-btn ${i === 0 ? 'active' : ''}`
              btn.textContent = p
              btn.onclick = () => showPathHeatmap(p)
              buttonsEl.appendChild(btn)
            })
          }

          const viewportEl = clone.querySelector('#heatmap-viewport')
          if (viewportEl) viewportEl.textContent = `Viewport: ${clicks[0]?.viewportWidth || '?'}x${clicks[0]?.viewportHeight || '?'}`
        }
      }

      // Journey
      const journeyEl = clone.querySelector('#session-journey') as HTMLElement
      const journeyTemplate = document.getElementById('journey-step-template') as HTMLTemplateElement
      if (journeyEl && journeyTemplate) {
        pageviews.forEach((p, i) => {
          const step = journeyTemplate.content.cloneNode(true) as DocumentFragment
          const pathEl = step.querySelector('.journey-step-path')
          const timeEl = step.querySelector('.journey-step-time')
          if (pathEl) pathEl.textContent = p.path
          if (timeEl) timeEl.textContent = new Date(p.timestamp).toLocaleTimeString()
          journeyEl.appendChild(step)
          if (i < pageviews.length - 1) {
            const arrow = document.createElement('span')
            arrow.className = 'journey-arrow'
            arrow.textContent = '→'
            journeyEl.appendChild(arrow)
          }
        })
      }

      // Timeline
      const timelineCountEl = clone.querySelector('#timeline-count')
      if (timelineCountEl) timelineCountEl.textContent = String(timeline.length)

      const timelineEl = clone.querySelector('#session-timeline') as HTMLElement
      const timelineTemplate = document.getElementById('timeline-item-template') as HTMLTemplateElement
      if (timelineEl && timelineTemplate) {
        timeline.forEach(t => {
          const item = timelineTemplate.content.cloneNode(true) as DocumentFragment
          const typeEl = item.querySelector('.timeline-type') as HTMLElement
          const contentEl = item.querySelector('.timeline-content') as HTMLElement
          const timeEl = item.querySelector('.timeline-time')

          if (typeEl) {
            typeEl.textContent = t.type
            typeEl.classList.add(t.type)
          }
          if (contentEl) {
            const contentTemplateId = `timeline-${t.type}-content`
            const contentTemplate = document.getElementById(contentTemplateId) as HTMLTemplateElement
            if (contentTemplate) {
              const contentClone = contentTemplate.content.cloneNode(true) as DocumentFragment
              if (t.type === 'pageview') {
                const pathEl = contentClone.querySelector('.timeline-path')
                if (pathEl) pathEl.textContent = t.data.path
              } else if (t.type === 'event') {
                const nameEl = contentClone.querySelector('.timeline-event-name')
                if (nameEl) nameEl.textContent = t.data.name
              } else if (t.type === 'click') {
                const textEl = contentClone.querySelector('.timeline-click-text')
                const elemEl = contentClone.querySelector('.timeline-click-element')
                if (textEl) textEl.textContent = `Click at (${t.data.viewportX}, ${t.data.viewportY}) on`
                if (elemEl) elemEl.textContent = t.data.elementTag || 'element'
              } else if (t.type === 'vital') {
                const metricEl = contentClone.querySelector('.timeline-vital-metric')
                const valueEl = contentClone.querySelector('.timeline-vital-value')
                if (metricEl) metricEl.textContent = t.data.metric
                if (valueEl) valueEl.textContent = `${t.data.value}ms (${t.data.rating})`
              } else if (t.type === 'error') {
                const msgEl = contentClone.querySelector('.timeline-error-message')
                if (msgEl) msgEl.textContent = (t.data.message || '').slice(0, 100)
              }
              contentEl.innerHTML = ''
              contentEl.appendChild(contentClone)
            }
          }
          if (timeEl) timeEl.textContent = new Date(t.timestamp).toLocaleTimeString()

          timelineEl.appendChild(item)
        })
      }

      modal.innerHTML = ''
      modal.appendChild(clone)
      modal.classList.add('active')

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
        const emptyTemplate = document.getElementById('heatmap-empty-template') as HTMLTemplateElement
        if (emptyTemplate) {
          container.innerHTML = ''
          container.appendChild(emptyTemplate.content.cloneNode(true))
        }
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

      // Clone the vitals tab template
      const template = document.getElementById('vitals-tab-template') as HTMLTemplateElement
      if (!template) return
      const clone = template.content.cloneNode(true) as DocumentFragment

      // Handle violations
      const violationsEl = clone.querySelector('#vitals-violations') as HTMLElement
      if (perfBudgetViolations.length > 0 && violationsEl) {
        violationsEl.style.display = 'block'
        const violationsTemplate = document.getElementById('violations-content-template') as HTMLTemplateElement
        const violationItemTemplate = document.getElementById('violation-item-template') as HTMLTemplateElement
        if (violationsTemplate && violationItemTemplate) {
          const violationsClone = violationsTemplate.content.cloneNode(true) as DocumentFragment
          const listEl = violationsClone.querySelector('.violations-list')
          if (listEl) {
            perfBudgetViolations.forEach(v => {
              const unit = v.metric === 'CLS' ? '' : 'ms'
              const item = violationItemTemplate.content.cloneNode(true) as DocumentFragment
              const metricEl = item.querySelector('.violation-metric')
              const valueEl = item.querySelector('.violation-value')
              const exceededEl = item.querySelector('.violation-exceeded')
              if (metricEl) metricEl.textContent = v.metric
              if (valueEl) valueEl.textContent = `${v.currentValue}${unit}`
              if (exceededEl) exceededEl.textContent = `(exceeds ${v.threshold}${unit} by ${v.exceededBy}${unit})`
              listEl.appendChild(item)
            })
          }
          violationsEl.innerHTML = ''
          violationsEl.appendChild(violationsClone)
        }
      }

      // Build vitals grid
      const vitalsGrid = clone.querySelector('#vitals-grid') as HTMLElement
      if (!vitalsGrid) return

      const cardTemplate = document.getElementById('vital-card-template') as HTMLTemplateElement
      if (!cardTemplate) return

      vitalsGrid.innerHTML = ''
      vitals.forEach(v => {
        const card = cardTemplate.content.cloneNode(true) as DocumentFragment
        const rating = getRating(v)

        const nameEl = card.querySelector('.vital-name')
        const valueEl = card.querySelector('.vital-value')
        const samplesEl = card.querySelector('.vital-samples')
        const barEl = card.querySelector('.vital-bar')

        if (nameEl) nameEl.textContent = v.metric
        if (valueEl) {
          valueEl.textContent = v.samples > 0 ? formatValue(v.metric, v.p75) : '—'
          if (rating) valueEl.classList.add(rating)
        }
        if (samplesEl) samplesEl.textContent = `${v.samples} samples`
        if (barEl) {
          if (v.samples > 0) {
            const goodBar = barEl.querySelector('.good') as HTMLElement
            const niBar = barEl.querySelector('.needs-improvement') as HTMLElement
            const poorBar = barEl.querySelector('.poor') as HTMLElement
            if (goodBar) goodBar.style.width = `${v.good}%`
            if (niBar) niBar.style.width = `${v.needsImprovement}%`
            if (poorBar) poorBar.style.width = `${v.poor}%`
          } else {
            (barEl as HTMLElement).style.display = 'none'
          }
        }

        vitalsGrid.appendChild(card)
      })

      tabContent.innerHTML = ''
      tabContent.appendChild(clone)
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

      const template = document.getElementById('errors-tab-template') as HTMLTemplateElement
      if (!template) return
      const clone = template.content.cloneNode(true) as DocumentFragment

      // Update filter dropdown
      const filterSelect = clone.querySelector('#error-status-filter') as HTMLSelectElement
      if (filterSelect) {
        filterSelect.value = errorStatusFilter
        const options = filterSelect.querySelectorAll('option')
        options[0].textContent = `All (${errors.length})`
        options[1].textContent = `New (${statusCounts.new})`
        options[2].textContent = `Resolved (${statusCounts.resolved})`
        options[3].textContent = `Ignored (${statusCounts.ignored})`
      }

      // Show/hide bulk actions
      const bulkResolveBtn = clone.querySelector('#bulk-resolve-btn') as HTMLElement
      const bulkIgnoreBtn = clone.querySelector('#bulk-ignore-btn') as HTMLElement
      if (statusCounts.new === 0) {
        bulkResolveBtn?.remove()
        bulkIgnoreBtn?.remove()
      }

      // Update count
      const countEl = clone.querySelector('#errors-count')
      if (countEl) countEl.textContent = `${filteredErrors.length} error${filteredErrors.length !== 1 ? 's' : ''}`

      // Build severity summary
      const summaryEl = clone.querySelector('#severity-summary') as HTMLElement
      const severityCardTemplate = document.getElementById('severity-card-template') as HTMLTemplateElement
      if (summaryEl && severityCardTemplate) {
        const severities = ['critical', 'high', 'medium', 'low']
        severities.forEach(sev => {
          const card = severityCardTemplate.content.cloneNode(true) as DocumentFragment
          const wrapper = card.querySelector('.severity-card') as HTMLElement
          const countEl = card.querySelector('.severity-card-count')
          const labelEl = card.querySelector('.severity-card-label')
          if (wrapper) wrapper.classList.add(sev)
          if (countEl) countEl.textContent = String(severityCounts[sev])
          if (labelEl) labelEl.textContent = severityLabels[sev]
          summaryEl.appendChild(card)
        })
      }

      // Build errors list
      const listEl = clone.querySelector('#errors-list') as HTMLElement
      if (!listEl) return

      if (filteredErrors.length === 0) {
        const emptyTitle = errorStatusFilter === 'all' ? 'No errors recorded' : `No ${errorStatusFilter} errors`
        const emptyHint = errorStatusFilter === 'all' ? 'Your application is running smoothly!' : 'Try a different filter.'
        const emptyTemplate = document.getElementById('errors-empty-template') as HTMLTemplateElement
        if (emptyTemplate) {
          const emptyClone = emptyTemplate.content.cloneNode(true) as DocumentFragment
          const titleEl = emptyClone.querySelector('.empty-state-title')
          const hintEl = emptyClone.querySelector('.empty-state-hint')
          if (titleEl) titleEl.textContent = emptyTitle
          if (hintEl) hintEl.textContent = emptyHint
          listEl.innerHTML = ''
          listEl.appendChild(emptyClone)
        }
      } else {
        const cardTemplate = document.getElementById('error-card-template') as HTMLTemplateElement
        if (!cardTemplate) return

        listEl.innerHTML = ''
        filteredErrors.forEach(e => {
          const errorId = getErrorId(e.message)
          const status = getErrorStatus(e.message)
          const severity = e.severity || 'medium'

          const card = cardTemplate.content.cloneNode(true) as DocumentFragment
          const wrapper = card.querySelector('.error-card-wrapper') as HTMLElement
          const link = card.querySelector('.error-card') as HTMLAnchorElement
          const gradient = card.querySelector('.error-card-gradient') as HTMLElement
          const severityEl = card.querySelector('.error-severity')
          const categoryEl = card.querySelector('.error-category')
          const statusEl = card.querySelector('.error-status')
          const countEl = card.querySelector('.error-count')
          const sourceEl = card.querySelector('.error-source')
          const messageEl = card.querySelector('.error-message')
          const firstSeenEl = card.querySelector('.error-first-seen')
          const lastSeenEl = card.querySelector('.error-last-seen')
          const browsersEl = card.querySelector('.error-browsers')
          const pathsEl = card.querySelector('.error-paths')
          const actionsEl = card.querySelector('.error-actions-inline')

          if (link) {
            link.href = `/errors/${encodeURIComponent(errorId)}?siteId=${siteId}`
            if (status === 'resolved') link.classList.add('resolved')
            if (status === 'ignored') link.classList.add('ignored')
          }
          if (gradient) gradient.classList.add(severity)
          if (severityEl) severityEl.textContent = severityLabels[severity] || 'Unknown'
          if (categoryEl) categoryEl.textContent = e.category || 'Error'
          if (statusEl) {
            statusEl.textContent = statusLabels[status] || 'New'
            statusEl.classList.add(status)
          }
          if (countEl) countEl.textContent = `${e.count} event${e.count !== 1 ? 's' : ''}`
          if (sourceEl) sourceEl.textContent = e.source ? e.source.split('/').pop() + ':' + e.line : 'Unknown source'
          if (messageEl) messageEl.textContent = e.message || 'Unknown error'
          if (firstSeenEl) {
            const tmpl = document.getElementById('error-first-seen-template') as HTMLTemplateElement
            if (tmpl) {
              const clone = tmpl.content.cloneNode(true) as DocumentFragment
              const text = clone.querySelector('.error-meta-text')
              if (text) text.textContent = `First: ${e.firstSeen ? new Date(e.firstSeen).toLocaleDateString() : 'N/A'}`
              firstSeenEl.innerHTML = ''
              firstSeenEl.appendChild(clone)
            }
          }
          if (lastSeenEl) {
            const tmpl = document.getElementById('error-last-seen-template') as HTMLTemplateElement
            if (tmpl) {
              const clone = tmpl.content.cloneNode(true) as DocumentFragment
              const text = clone.querySelector('.error-meta-text')
              if (text) text.textContent = `Last: ${new Date(e.lastSeen).toLocaleString()}`
              lastSeenEl.innerHTML = ''
              lastSeenEl.appendChild(clone)
            }
          }
          if (browsersEl) {
            const tmpl = document.getElementById('error-browsers-template') as HTMLTemplateElement
            if (tmpl) {
              const clone = tmpl.content.cloneNode(true) as DocumentFragment
              const text = clone.querySelector('.error-meta-text')
              if (text) text.textContent = (e.browsers || []).join(', ') || 'Unknown'
              browsersEl.innerHTML = ''
              browsersEl.appendChild(clone)
            }
          }
          if (pathsEl) {
            const tmpl = document.getElementById('error-paths-template') as HTMLTemplateElement
            if (tmpl) {
              const clone = tmpl.content.cloneNode(true) as DocumentFragment
              const text = clone.querySelector('.error-meta-text')
              if (text) text.textContent = `${(e.paths || []).length} page${(e.paths || []).length !== 1 ? 's' : ''}`
              pathsEl.innerHTML = ''
              pathsEl.appendChild(clone)
            }
          }

          if (actionsEl) {
            actionsEl.setAttribute('onclick', 'event.preventDefault();event.stopPropagation()')
            if (status !== 'resolved') {
              const btn = document.createElement('button')
              btn.className = 'btn btn-resolve'
              btn.textContent = '✓ Resolve'
              btn.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); updateErrorStatus(encodeURIComponent(errorId), 'resolved', ev) }
              actionsEl.appendChild(btn)
            }
            if (status !== 'ignored') {
              const btn = document.createElement('button')
              btn.className = 'btn btn-secondary'
              btn.textContent = 'Ignore'
              btn.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); updateErrorStatus(encodeURIComponent(errorId), 'ignored', ev) }
              actionsEl.appendChild(btn)
            }
            if (status !== 'new') {
              const btn = document.createElement('button')
              btn.className = 'btn btn-secondary'
              btn.textContent = 'Reopen'
              btn.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); updateErrorStatus(encodeURIComponent(errorId), 'new', ev) }
              actionsEl.appendChild(btn)
            }
          }

          listEl.appendChild(card)
        })
      }

      tabContent.innerHTML = ''
      tabContent.appendChild(clone)
    }

    // Render insights
    function renderInsights() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      const icons: Record<string, string> = {
        traffic: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>',
        referrer: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101"/></svg>',
        page: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
        device: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>',
        engagement: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>'
      }

      const template = document.getElementById('insights-tab-template') as HTMLTemplateElement
      if (!template) return
      const clone = template.content.cloneNode(true) as DocumentFragment

      // Build stats section
      const statsEl = clone.querySelector('#insights-stats') as HTMLElement
      if (statsEl && comparisonStats) {
        const statItems = [
          { value: fmt(comparisonStats.thisWeekViews), label: 'Views This Week', change: comparisonStats.change },
          { value: fmt(comparisonStats.lastWeekViews), label: 'Views Last Week' },
          { value: String(comparisonStats.sessions || 0), label: 'Sessions' },
          { value: `${comparisonStats.bounceRate || 0}%`, label: 'Bounce Rate' }
        ]
        const statTemplate = document.getElementById('insights-stat-template') as HTMLTemplateElement
        statItems.forEach(item => {
          if (statTemplate) {
            const stat = statTemplate.content.cloneNode(true) as DocumentFragment
            const valueEl = stat.querySelector('.insights-stat-value')
            const labelEl = stat.querySelector('.insights-stat-label')
            const changeEl = stat.querySelector('.insights-stat-change') as HTMLElement
            if (valueEl) valueEl.textContent = item.value
            if (labelEl) labelEl.textContent = item.label
            if (changeEl && item.change !== undefined && item.change !== 0) {
              changeEl.style.display = 'block'
              changeEl.classList.add(item.change > 0 ? 'positive' : 'negative')
              changeEl.textContent = `${item.change > 0 ? '+' : ''}${item.change}%`
            }
            statsEl.appendChild(stat)
          }
        })
      }

      // Build insights list
      const listEl = clone.querySelector('#insights-list') as HTMLElement
      if (!listEl) return

      if (insights.length === 0) {
        const emptyTemplate = document.getElementById('insights-list-empty-template') as HTMLTemplateElement
        if (emptyTemplate) {
          listEl.innerHTML = ''
          listEl.appendChild(emptyTemplate.content.cloneNode(true))
        }
      } else {
        const cardTemplate = document.getElementById('insight-card-template') as HTMLTemplateElement
        if (!cardTemplate) return

        listEl.innerHTML = ''
        insights.forEach(i => {
          const card = cardTemplate.content.cloneNode(true) as DocumentFragment
          const iconEl = card.querySelector('.insight-icon') as HTMLElement
          const titleEl = card.querySelector('.insight-title')
          const descEl = card.querySelector('.insight-desc')

          if (iconEl) {
            iconEl.classList.add(i.severity || 'info')
            iconEl.innerHTML = icons[i.type] || icons.traffic
          }
          if (titleEl) titleEl.textContent = i.title
          if (descEl) descEl.textContent = i.description

          listEl.appendChild(card)
        })
      }

      tabContent.innerHTML = ''
      tabContent.appendChild(clone)
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

      const template = document.getElementById('live-tab-template') as HTMLTemplateElement
      if (!template) return
      const clone = template.content.cloneNode(true) as DocumentFragment

      const activitiesEl = clone.querySelector('#live-activities') as HTMLElement
      if (!activitiesEl) return

      if (liveActivities.length === 0) {
        const emptyTemplate = document.getElementById('live-activity-empty-template') as HTMLTemplateElement
        if (emptyTemplate) {
          activitiesEl.innerHTML = ''
          activitiesEl.appendChild(emptyTemplate.content.cloneNode(true))
        }
      } else {
        const activityTemplate = document.getElementById('live-activity-template') as HTMLTemplateElement
        if (!activityTemplate) return

        activitiesEl.innerHTML = ''
        liveActivities.forEach(a => {
          const card = activityTemplate.content.cloneNode(true) as DocumentFragment
          const pathEl = card.querySelector('.live-activity-path')
          const metaEl = card.querySelector('.live-activity-meta')
          const timeEl = card.querySelector('.live-activity-time')

          if (pathEl) pathEl.textContent = a.path || '/'
          if (metaEl) metaEl.textContent = `${a.country || 'Unknown'} • ${a.device || 'Unknown'} • ${a.browser || 'Unknown'}`
          if (timeEl) timeEl.textContent = timeAgo(a.timestamp)

          activitiesEl.appendChild(card)
        })
      }

      tabContent.innerHTML = ''
      tabContent.appendChild(clone)
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

      const template = document.getElementById('funnels-tab-template') as HTMLTemplateElement
      if (!template) return
      const clone = template.content.cloneNode(true) as DocumentFragment

      const listEl = clone.querySelector('#funnels-list') as HTMLElement
      if (!listEl) return

      if (funnels.length === 0) {
        const emptyTemplate = document.getElementById('funnels-empty-template') as HTMLTemplateElement
        if (emptyTemplate) {
          listEl.innerHTML = ''
          listEl.appendChild(emptyTemplate.content.cloneNode(true))
        }
      } else {
        const cardTemplate = document.getElementById('funnel-card-template') as HTMLTemplateElement
        if (!cardTemplate) return

        listEl.innerHTML = ''
        funnels.forEach(f => {
          const card = cardTemplate.content.cloneNode(true) as DocumentFragment
          const nameEl = card.querySelector('.funnel-name')
          const analyzeBtn = card.querySelector('.btn-icon')
          const stepsEl = card.querySelector('.funnel-steps')

          if (nameEl) nameEl.textContent = f.name
          if (analyzeBtn) analyzeBtn.setAttribute('onclick', `analyzeFunnel('${f.id}')`)
          if (stepsEl) {
            stepsEl.innerHTML = ''
            const steps = f.steps || []
            steps.forEach((s, i) => {
              const stepSpan = document.createElement('span')
              stepSpan.className = 'funnel-step'
              stepSpan.textContent = `${i + 1}. ${s.name}`
              stepsEl.appendChild(stepSpan)
              if (i < steps.length - 1) {
                const arrow = document.createElement('span')
                arrow.className = 'funnel-step-arrow'
                arrow.textContent = '→'
                stepsEl.appendChild(arrow)
              }
            })
          }

          listEl.appendChild(card)
        })
      }

      tabContent.innerHTML = ''
      tabContent.appendChild(clone)
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

      const template = document.getElementById('funnel-analysis-template') as HTMLTemplateElement
      if (!template) return
      const clone = template.content.cloneNode(true) as DocumentFragment

      const titleEl = clone.querySelector('.funnel-analysis-title')
      const summaryEl = clone.querySelector('.funnel-analysis-summary')
      const stepsEl = clone.querySelector('.funnel-steps-analysis') as HTMLElement

      if (titleEl) titleEl.textContent = funnel.name
      if (summaryEl) summaryEl.textContent = `${totalSessions} sessions analyzed • ${overallConversion}% overall conversion`

      const stepTemplate = document.getElementById('funnel-analysis-step-template') as HTMLTemplateElement
      if (stepsEl && stepTemplate) {
        steps.forEach((s, i) => {
          const step = stepTemplate.content.cloneNode(true) as DocumentFragment
          const visitorsEl = step.querySelector('.analysis-step-visitors')
          const rateEl = step.querySelector('.analysis-step-rate')
          const nameEl = step.querySelector('.analysis-step-name')
          const dropEl = step.querySelector('.analysis-step-drop') as HTMLElement

          if (visitorsEl) visitorsEl.textContent = String(s.visitors)
          if (rateEl) rateEl.textContent = `${s.conversionRate}% of total`
          if (nameEl) nameEl.textContent = s.name
          if (dropEl) {
            if (i > 0) {
              dropEl.textContent = `↓ ${s.dropoffRate}% drop`
            } else {
              dropEl.style.display = 'none'
            }
          }

          stepsEl.appendChild(step)

          if (i < steps.length - 1) {
            const arrow = document.createElement('div')
            arrow.className = 'analysis-arrow'
            arrow.textContent = '→'
            stepsEl.appendChild(arrow)
          }
        })
      }

      tabContent.innerHTML = ''
      tabContent.appendChild(clone)
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

    // Helper to render a list of items
    function renderSettingsList(container: HTMLElement, items: any[], template: HTMLTemplateElement, renderItem: (item: any, el: DocumentFragment) => void, emptyText: string) {
      if (!items || items.length === 0) {
        const emptyTemplate = document.getElementById('settings-empty-template') as HTMLTemplateElement
        if (emptyTemplate) {
          const emptyClone = emptyTemplate.content.cloneNode(true) as DocumentFragment
          const emptyEl = emptyClone.querySelector('.panel-empty')
          if (emptyEl) emptyEl.textContent = emptyText
          container.innerHTML = ''
          container.appendChild(emptyClone)
        }
        return
      }
      container.innerHTML = ''
      items.forEach(item => {
        const el = template.content.cloneNode(true) as DocumentFragment
        renderItem(item, el)
        container.appendChild(el)
      })
    }

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

      const template = document.getElementById('settings-tab-template') as HTMLTemplateElement
      if (!template) return
      const clone = template.content.cloneNode(true) as DocumentFragment

      // API Keys
      const apiKeysList = clone.querySelector('#api-keys-list') as HTMLElement
      const apiKeyTemplate = document.getElementById('api-key-item-template') as HTMLTemplateElement
      if (apiKeysList && apiKeyTemplate) {
        renderSettingsList(apiKeysList, apiKeys.apiKeys || [], apiKeyTemplate, (k, el) => {
          const nameEl = el.querySelector('.list-item-name')
          const codeEl = el.querySelector('.list-item-code')
          const deleteBtn = el.querySelector('.btn-icon')
          if (nameEl) nameEl.textContent = k.name || 'API Key'
          if (codeEl) codeEl.textContent = k.key
          if (deleteBtn) deleteBtn.setAttribute('onclick', `deleteApiKey('${k.key}')`)
        }, 'No API keys yet.')
      }

      // Alerts
      const alertsList = clone.querySelector('#alerts-list') as HTMLElement
      const alertTemplate = document.getElementById('alert-item-template') as HTMLTemplateElement
      if (alertsList && alertTemplate) {
        renderSettingsList(alertsList, alerts.alerts || [], alertTemplate, (a, el) => {
          const nameEl = el.querySelector('.list-item-name')
          const metaEl = el.querySelector('.list-item-meta')
          const deleteBtn = el.querySelector('.btn-icon')
          if (nameEl) nameEl.textContent = a.name
          if (metaEl) metaEl.textContent = `${a.type} • >${a.threshold}%`
          if (deleteBtn) deleteBtn.setAttribute('onclick', `deleteAlert('${a.id}')`)
        }, 'No alerts configured.')
      }

      // Email Reports
      const emailList = clone.querySelector('#email-reports-list') as HTMLElement
      const emailTemplate = document.getElementById('email-report-template') as HTMLTemplateElement
      if (emailList && emailTemplate) {
        renderSettingsList(emailList, emailReports.reports || [], emailTemplate, (r, el) => {
          const nameEl = el.querySelector('.list-item-name')
          const metaEl = el.querySelector('.list-item-meta')
          const deleteBtn = el.querySelector('.btn-icon')
          if (nameEl) nameEl.textContent = r.email
          if (metaEl) metaEl.textContent = r.frequency
          if (deleteBtn) deleteBtn.setAttribute('onclick', `deleteEmailReport('${r.id}')`)
        }, 'No email reports scheduled.')
      }

      // Uptime
      const uptimeList = clone.querySelector('#uptime-list') as HTMLElement
      const uptimeTemplate = document.getElementById('uptime-item-template') as HTMLTemplateElement
      if (uptimeList && uptimeTemplate) {
        renderSettingsList(uptimeList, uptime.monitors || [], uptimeTemplate, (m, el) => {
          const codeEl = el.querySelector('.list-item-code')
          const metaEl = el.querySelector('.list-item-meta')
          const deleteBtn = el.querySelector('.btn-icon')
          if (codeEl) codeEl.textContent = m.url
          if (metaEl) metaEl.textContent = `Every ${m.interval} min`
          if (deleteBtn) deleteBtn.setAttribute('onclick', `deleteUptimeMonitor('${m.id}')`)
        }, 'No monitors configured.')
      }

      // Team
      const teamList = clone.querySelector('#team-list') as HTMLElement
      const teamTemplate = document.getElementById('team-member-template') as HTMLTemplateElement
      if (teamList && teamTemplate) {
        renderSettingsList(teamList, team.members || [], teamTemplate, (m, el) => {
          const nameEl = el.querySelector('.list-item-name')
          const roleEl = el.querySelector('.list-item-role')
          if (nameEl) nameEl.textContent = m.email
          if (roleEl) roleEl.textContent = `${m.role} • ${m.status}`
        }, 'No team members yet.')
      }

      // Webhooks
      const webhooksList = clone.querySelector('#webhooks-list') as HTMLElement
      const webhookTemplate = document.getElementById('webhook-item-template') as HTMLTemplateElement
      if (webhooksList && webhookTemplate) {
        renderSettingsList(webhooksList, webhooks.webhooks || [], webhookTemplate, (w, el) => {
          const codeEl = el.querySelector('.list-item-code')
          const eventsEl = el.querySelector('.list-item-events')
          const deleteBtn = el.querySelector('.btn-icon')
          if (codeEl) codeEl.textContent = `${w.type} • ${w.url.slice(0, 30)}...`
          if (eventsEl) eventsEl.remove()
          if (deleteBtn) deleteBtn.setAttribute('onclick', `deleteWebhook('${w.id}')`)
        }, 'No webhooks configured.')
      }

      // Performance Budgets
      const perfList = clone.querySelector('#perf-budgets-list') as HTMLElement
      const perfTemplate = document.getElementById('perf-budget-template') as HTMLTemplateElement
      if (perfList && perfTemplate) {
        renderSettingsList(perfList, perfBudgets.budgets || [], perfTemplate, (b, el) => {
          const nameEl = el.querySelector('.list-item-name')
          const metaEl = el.querySelector('.list-item-meta')
          const deleteBtn = el.querySelector('.btn-icon')
          if (nameEl) nameEl.textContent = b.metric
          if (metaEl) metaEl.textContent = `Max: ${b.threshold}${b.metric === 'CLS' ? '' : 'ms'}`
          if (deleteBtn) deleteBtn.setAttribute('onclick', `deletePerfBudget('${b.id}')`)
        }, 'No budgets configured.')
      }

      // Retention
      const retentionEl = clone.querySelector('#retention-days')
      if (retentionEl) retentionEl.textContent = `${retention.retentionDays} days`

      tabContent.innerHTML = ''
      tabContent.appendChild(clone)
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
      const countrySelect = document.getElementById('filter-country')
      const browserSelect = document.getElementById('filter-browser')
      if (countrySelect && countries.length > 0) {
        const opts = countries.slice(0, 20).map(c => '<option value="' + (c.country || c.name) + '">' + (c.country || c.name) + '</option>')
        countrySelect.innerHTML = '<option value="">All Countries</option>' + opts.join('')
      }
      if (browserSelect && browsers.length > 0) {
        const opts = browsers.slice(0, 10).map(b => '<option value="' + (b.browser || b.name) + '">' + (b.browser || b.name) + '</option>')
        browserSelect.innerHTML = '<option value="">All Browsers</option>' + opts.join('')
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
        document.getElementById('stat-sessions').innerHTML = fmt(stats.sessions) + (comparisonData ? compBadge(comparisonData.changes?.sessions) : '')
        document.getElementById('stat-people').innerHTML = fmt(stats.people) + (comparisonData ? compBadge(comparisonData.changes?.visitors) : '')
        document.getElementById('stat-views').innerHTML = fmt(stats.views) + (comparisonData ? compBadge(comparisonData.changes?.pageviews) : '')
        document.getElementById('stat-bounce').innerHTML = stats.bounceRate + '%' + (comparisonData ? compBadge(comparisonData.changes?.bounceRate) : '')
        document.getElementById('stat-avgtime').innerHTML = stats.avgTime + (comparisonData ? compBadge(comparisonData.changes?.avgDuration) : '')
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

      // Render tables using templates
      renderTableRows('pages-body', pages.slice(0, 10), 'page-row-template', 4, 'No page data', (row, p) => {
        const pageCell = row.querySelector('.page-cell')
        if (pageCell) {
          if (siteHostname) {
            const pageUrl = `https://${siteHostname}${p.path}`
            const link = document.createElement('a')
            link.href = pageUrl
            link.target = '_blank'
            link.rel = 'noopener'
            link.className = 'page-link'
            link.title = `Visit ${pageUrl}`
            link.textContent = p.path
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            svg.setAttribute('width', '10')
            svg.setAttribute('height', '10')
            svg.setAttribute('viewBox', '0 0 24 24')
            svg.setAttribute('fill', 'none')
            svg.setAttribute('stroke', 'currentColor')
            svg.setAttribute('stroke-width', '2')
            svg.style.marginLeft = '4px'
            svg.style.opacity = '0.5'
            svg.innerHTML = '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>'
            link.appendChild(svg)
            pageCell.appendChild(link)
          } else {
            pageCell.textContent = p.path
          }
          pageCell.setAttribute('title', p.path)
        }
        const entriesCell = row.querySelector('.entries-cell')
        if (entriesCell) entriesCell.textContent = fmt(p.entries || 0)
        const visitorsCell = row.querySelector('.visitors-cell')
        if (visitorsCell) visitorsCell.textContent = fmt(p.visitors || 0)
        const viewsCell = row.querySelector('.views-cell')
        if (viewsCell) viewsCell.textContent = fmt(p.views || 0)
      })

      renderTableRows('referrers-body', referrers.slice(0, 10), 'referrer-row-template', 3, 'No referrer data', (row, r) => {
        const referrerCell = row.querySelector('.referrer-cell')
        if (referrerCell) {
          const source = r.source || 'Direct'
          const sourceLower = source.toLowerCase()
          const isLink = sourceLower !== 'direct' && !source.includes('(') && source.includes('.')
          if (isLink) {
            const domain = source.replace(/^https?:\/\//, '').split('/')[0]
            const link = document.createElement('a')
            link.href = source.startsWith('http') ? source : 'https://' + source
            link.target = '_blank'
            link.rel = 'noopener'
            link.className = 'referrer-link'
            const img = document.createElement('img')
            img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`
            img.width = 14
            img.height = 14
            img.className = 'referrer-favicon'
            img.onerror = () => { img.style.display = 'none' }
            link.appendChild(img)
            link.appendChild(document.createTextNode(source))
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            svg.setAttribute('width', '12')
            svg.setAttribute('height', '12')
            svg.setAttribute('fill', 'none')
            svg.setAttribute('stroke', 'currentColor')
            svg.setAttribute('viewBox', '0 0 24 24')
            svg.style.opacity = '0.5'
            svg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>'
            link.appendChild(svg)
            referrerCell.appendChild(link)
          } else {
            referrerCell.textContent = source
          }
        }
        const visitorsCell = row.querySelector('.visitors-cell')
        if (visitorsCell) visitorsCell.textContent = fmt(r.visitors || 0)
        const viewsCell = row.querySelector('.views-cell')
        if (viewsCell) viewsCell.textContent = fmt(r.views || 0)
      })

      renderTableRows('devices-body', deviceTypes, 'device-row-template', 3, 'No device data', (row, d) => {
        const deviceCell = row.querySelector('.device-cell')
        if (deviceCell) deviceCell.innerHTML = getDeviceIcon(d.type) + d.type
        const visitorsCell = row.querySelector('.visitors-cell')
        if (visitorsCell) visitorsCell.textContent = fmt(d.visitors || 0)
        const pctCell = row.querySelector('.pct-cell')
        if (pctCell) pctCell.textContent = `${d.percentage || 0}%`
      })

      renderTableRows('browsers-body', browsers.slice(0, 8), 'browser-row-template', 3, 'No browser data', (row, b) => {
        const browserCell = row.querySelector('.browser-cell')
        if (browserCell) browserCell.innerHTML = getBrowserIcon(b.name) + b.name
        const visitorsCell = row.querySelector('.visitors-cell')
        if (visitorsCell) visitorsCell.textContent = fmt(b.visitors || 0)
        const pctCell = row.querySelector('.pct-cell')
        if (pctCell) pctCell.textContent = `${b.percentage || 0}%`
      })

      renderTableRows('countries-body', countries.slice(0, 8), 'country-row-template', 2, 'No location data', (row, c) => {
        const countryCell = row.querySelector('.country-cell')
        if (countryCell) {
          const flag = document.createElement('span')
          flag.className = 'country-flag'
          flag.textContent = getCountryFlag(c.name)
          countryCell.appendChild(flag)
          countryCell.appendChild(document.createTextNode(c.name || c.code || 'Unknown'))
        }
        const visitorsCell = row.querySelector('.visitors-cell')
        if (visitorsCell) visitorsCell.textContent = fmt(c.visitors || 0)
      })

      renderTableRows('campaigns-body', campaigns.slice(0, 8), 'campaign-row-template', 3, 'No campaign data', (row, c) => {
        const campaignCell = row.querySelector('.campaign-cell')
        if (campaignCell) campaignCell.textContent = c.name || c.source || 'Unknown'
        const visitorsCell = row.querySelector('.visitors-cell')
        if (visitorsCell) visitorsCell.textContent = fmt(c.visitors || 0)
        const viewsCell = row.querySelector('.views-cell')
        if (viewsCell) viewsCell.textContent = fmt(c.views || 0)
      })

      // Enhanced events display with mini chart
      const eventsContainer = document.getElementById('events-container')
      if (eventsContainer) {
        if (!events.length) {
          const emptyTemplate = document.getElementById('events-empty-template') as HTMLTemplateElement
          if (emptyTemplate) {
            eventsContainer.innerHTML = ''
            eventsContainer.appendChild(emptyTemplate.content.cloneNode(true))
          }
        } else {
          const listTemplate = document.getElementById('events-list-template') as HTMLTemplateElement
          const itemTemplate = document.getElementById('event-item-template') as HTMLTemplateElement
          if (listTemplate && itemTemplate) {
            const totalEventCount = events.reduce((sum, e) => sum + (e.count || 0), 0)
            const maxEventCount = Math.max(...events.map(e => e.count || 0), 1)

            const listClone = listTemplate.content.cloneNode(true) as DocumentFragment
            const listEl = listClone.querySelector('.events-list')

            events.slice(0, 8).forEach(e => {
              const pct = Math.round(((e.count || 0) / totalEventCount) * 100)
              const barWidth = Math.round(((e.count || 0) / maxEventCount) * 100)

              const item = itemTemplate.content.cloneNode(true) as DocumentFragment
              const nameEl = item.querySelector('.event-bar-name')
              const pctEl = item.querySelector('.event-bar-pct')
              const fillEl = item.querySelector('.event-bar-fill') as HTMLElement
              const countEl = item.querySelector('.event-bar-count')

              if (nameEl) nameEl.textContent = e.name
              if (pctEl) pctEl.textContent = `${pct}%`
              if (fillEl) fillEl.style.width = `${barWidth}%`
              if (countEl) countEl.textContent = fmt(e.count || 0)

              listEl?.appendChild(item)
            })

            eventsContainer.innerHTML = ''
            eventsContainer.appendChild(listClone)
          }
        }
      }

      renderChart()
      renderGoals()
    }

    function renderGoals() {
      const container = document.getElementById('goals-container')
      if (!container) return

      if (!goals.length) {
        const emptyTemplate = document.getElementById('goals-empty-template') as HTMLTemplateElement
        if (emptyTemplate) {
          container.innerHTML = ''
          container.appendChild(emptyTemplate.content.cloneNode(true))
        }
        return
      }

      const tableTemplate = document.getElementById('goals-table-template') as HTMLTemplateElement
      const rowTemplate = document.getElementById('goal-row-template') as HTMLTemplateElement
      if (!tableTemplate || !rowTemplate) return

      const tableClone = tableTemplate.content.cloneNode(true) as DocumentFragment
      const tbody = tableClone.querySelector('#goals-table-body')
      if (!tbody) return

      goals.forEach(g => {
        const row = rowTemplate.content.cloneNode(true) as DocumentFragment

        const nameEl = row.querySelector('.goal-name')
        const badgeEl = row.querySelector('.goal-type-badge')
        const conversionsEl = row.querySelector('.goal-conversions')
        const valueEl = row.querySelector('.goal-value')
        const editBtn = row.querySelector('.edit-btn')
        const deleteBtn = row.querySelector('.delete-btn')

        if (nameEl) nameEl.textContent = g.name
        if (badgeEl) {
          badgeEl.textContent = g.type
          badgeEl.classList.add(g.type)
        }
        if (conversionsEl) conversionsEl.textContent = fmt(g.conversions || 0)
        if (valueEl) valueEl.textContent = g.totalValue ? '$' + g.totalValue.toFixed(2) : '-'
        if (editBtn) editBtn.addEventListener('click', () => editGoal(g.id))
        if (deleteBtn) deleteBtn.addEventListener('click', () => deleteGoal(g.id))

        tbody.appendChild(row)
      })

      container.innerHTML = ''
      container.appendChild(tableClone)
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

      canvas.onmousemove = function(e) {
        const cr = canvas.getBoundingClientRect()
        const mx = e.clientX - cr.left
        let closest = -1, minDist = 30
        points.forEach((p, i) => { const d = Math.abs(mx - p.x); if (d < minDist) { minDist = d; closest = i } })
        if (closest >= 0) {
          const p = points[closest], d = p.data
          tooltip.innerHTML = '<div style="color:var(--muted);font-size:11px;margin-bottom:6px;font-weight:500">' + fmtDateFull(d.date) + '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:8px;height:8px;background:var(--accent2);border-radius:2px"></span>Views: <strong style="margin-left:auto">' + fmt(d.views || d.count || 0) + '</strong></div>' +
            '<div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:8px;height:8px;background:var(--success);border-radius:2px"></span>Visitors: <strong style="margin-left:auto">' + fmt(d.visitors || 0) + '</strong></div>'
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

