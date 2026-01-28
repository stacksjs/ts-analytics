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
      'Chrome': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#4285F4" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#4285F4"/><path d="M12 2v6" stroke="#EA4335" stroke-width="2"/><path d="M5 17l5-3" stroke="#FBBC05" stroke-width="2"/><path d="M19 17l-5-3" stroke="#34A853" stroke-width="2"/></svg>',
      'Safari': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#0FB5EE" stroke-width="2"/><path d="M12 2L14 12L12 22" stroke="#FF5722" stroke-width="1"/><path d="M2 12L12 10L22 12" stroke="#0FB5EE" stroke-width="1"/></svg>',
      'Firefox': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#FF6611" stroke-width="2" fill="#FFBD4F"/><path d="M8 8c2-2 6-2 8 0s2 6 0 8" stroke="#FF6611" stroke-width="2"/></svg>',
      'Edge': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#0078D7" stroke-width="2"/><path d="M6 12c0-4 3-6 6-6s6 2 6 6" stroke="#0078D7" stroke-width="2"/></svg>',
      'Opera': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><ellipse cx="12" cy="12" rx="6" ry="10" stroke="#FF1B2D" stroke-width="2"/></svg>',
      'Brave': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><path d="M12 2L4 6v6c0 5.5 3.5 10.7 8 12 4.5-1.3 8-6.5 8-12V6l-8-4z" stroke="#FB542B" stroke-width="2"/></svg>',
      'IE': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="#0076D6" stroke-width="2"/><path d="M4 12h16" stroke="#0076D6" stroke-width="2"/></svg>',
      'Bot': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="2"/><circle cx="15" cy="14" r="2"/><path d="M12 2v4M6 6l2 2M18 6l-2 2"/></svg>',
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
      'desktop': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
      'mobile': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
      'tablet': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
    }
    function getDeviceIcon(type) {
      return deviceIcons[type?.toLowerCase()] || deviceIcons['desktop']
    }

    async function fetchSites() {
      const container = document.getElementById('site-list')
      container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading sites...</p></div>'
      try {
        const res = await fetch(`${API_ENDPOINT}/api/sites`)
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        availableSites = data.sites || []
        renderSiteSelector()
      } catch (err) {
        container.innerHTML = '<div class="error"><p>Failed to load sites</p><button onclick="fetchSites()">Retry</button></div>'
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
      const url = new URL(window.location.href)
      url.searchParams.set('siteId', id)
      window.history.pushState({}, '', url)

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
      const spinStartTime = Date.now()
      document.getElementById('refresh-btn').classList.add('spinning')

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
        timeSeriesData = timeseriesRes.timeSeries || []
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
        // Ensure spinner completes at least one full rotation (1s animation)
        const elapsed = Date.now() - spinStartTime
        const minSpinTime = 1000
        const remainingTime = Math.max(0, minSpinTime - elapsed)
        setTimeout(() => {
          document.getElementById('refresh-btn').classList.remove('spinning')
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

      // Group nodes by layer (approximation based on incoming/outgoing links)
      const entryNodes = nodes.filter(n => n.id === '/' || links.every(l => l.target !== n.id || l.source === n.id))
      const otherNodes = nodes.filter(n => !entryNodes.includes(n))

      tabContent.innerHTML = `
        <div style="grid-column:1/-1">
          <h3 style="margin-bottom:0.5rem;font-size:1rem">User Flow</h3>
          <p style="font-size:0.75rem;color:var(--muted);margin-bottom:1.5rem">Showing top paths from ${analyzedSessions} of ${totalSessions} multi-page sessions</p>

          <div style="display:flex;gap:2rem;overflow-x:auto;padding-bottom:1rem">
            <!-- Entry pages -->
            <div style="min-width:200px">
              <h4 style="font-size:0.6875rem;text-transform:uppercase;color:var(--muted);margin-bottom:0.75rem">Entry Pages</h4>
              ${entryNodes.slice(0, 8).map(n => `
                <div style="background:var(--bg);border:1px solid var(--border);padding:0.5rem 0.75rem;border-radius:6px;margin-bottom:0.5rem">
                  <div style="font-size:0.8125rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.id}</div>
                  <div style="font-size:0.6875rem;color:var(--muted)">${n.count} visits</div>
                </div>
              `).join('')}
            </div>

            <!-- Flow connections -->
            <div style="min-width:300px;flex:1">
              <h4 style="font-size:0.6875rem;text-transform:uppercase;color:var(--muted);margin-bottom:0.75rem">Top Flows</h4>
              ${links.slice(0, 15).map(l => `
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;font-size:0.75rem">
                  <span style="background:var(--bg);padding:0.25rem 0.5rem;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">${l.source}</span>
                  <span style="color:var(--accent)">→</span>
                  <span style="background:var(--bg);padding:0.25rem 0.5rem;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">${l.target}</span>
                  <span style="color:var(--muted);margin-left:auto">${l.value}x</span>
                </div>
              `).join('')}
            </div>

            <!-- Top pages by traffic -->
            <div style="min-width:200px">
              <h4 style="font-size:0.6875rem;text-transform:uppercase;color:var(--muted);margin-bottom:0.75rem">Most Visited</h4>
              ${nodes.slice(0, 10).map((n, i) => `
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
                  <span style="width:18px;height:18px;background:var(--accent);color:white;border-radius:50%;font-size:0.6875rem;display:flex;align-items:center;justify-content:center">${i + 1}</span>
                  <span style="font-size:0.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${n.id}</span>
                  <span style="font-size:0.6875rem;color:var(--muted)">${n.count}</span>
                </div>
              `).join('')}
            </div>
          </div>

          ${links.length === 0 ? '<div class="empty-cell">No flow data available. Users need to visit multiple pages in a session.</div>' : ''}
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
      tabContent.innerHTML = `
        <div style="grid-column: 1/-1">
          <h3 style="margin-bottom:1rem;font-size:1rem">Sessions (${sessions.length})</h3>
          <div class="session-list">
            ${sessions.length === 0 ? '<div class="empty-cell">No sessions found</div>' : sessions.map(s => `
              <div class="session-card" onclick="viewSession('${s.id}')">
                <div class="session-header">
                  <span style="font-weight:500">${s.entryPath || '/'}</span>
                  <span style="font-size:0.75rem;color:var(--muted)">${new Date(s.startedAt).toLocaleString()}</span>
                </div>
                <div class="session-meta">
                  <span>${s.pageViewCount || 0} pages</span>
                  <span>${formatDuration(s.duration)}</span>
                  <span>${s.browser || 'Unknown'}</span>
                  <span>${s.country || 'Unknown'}</span>
                  ${s.isBounce ? '<span style="color:var(--error)">Bounced</span>' : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `
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
      const clicksByPath = {}
      for (const c of clicks) {
        const path = c.path || '/'
        if (!clicksByPath[path]) clicksByPath[path] = []
        clicksByPath[path].push(c)
      }

      // Get unique paths visited
      const paths = [...new Set(pageviews.map(p => p.path))]

      modal.innerHTML = `
        <div class="session-modal-content" style="max-width:1000px">
          <div class="modal-header">
            <h3>Session: ${s.id?.slice(0,8) || 'Unknown'}</h3>
            <button class="modal-close" onclick="closeModal()">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem">
              <div class="stat" style="padding:1rem"><div class="stat-val" style="font-size:1.25rem">${s.pageViewCount || 0}</div><div class="stat-lbl">Pages</div></div>
              <div class="stat" style="padding:1rem"><div class="stat-val" style="font-size:1.25rem">${formatDuration(s.duration)}</div><div class="stat-lbl">Duration</div></div>
              <div class="stat" style="padding:1rem"><div class="stat-val" style="font-size:1.25rem">${s.browser || '?'}</div><div class="stat-lbl">Browser</div></div>
              <div class="stat" style="padding:1rem"><div class="stat-val" style="font-size:1.25rem">${s.country || '?'}</div><div class="stat-lbl">Country</div></div>
            </div>

            ${clicks.length > 0 ? `
            <h4 style="margin-bottom:0.75rem;font-size:0.875rem;color:var(--muted)">Click Heatmap (${clicks.length} clicks)</h4>
            <div style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap">
              ${paths.map((p, i) => `<button class="date-btn ${i===0?'active':''}" onclick="showPathHeatmap('${p}')">${p}</button>`).join('')}
            </div>
            <div id="heatmap-container" style="position:relative;width:100%;height:400px;background:var(--bg);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:1.5rem">
              <div id="heatmap-clicks" style="position:absolute;inset:0"></div>
              <div style="position:absolute;bottom:10px;right:10px;font-size:0.6875rem;color:var(--muted);background:var(--bg2);padding:0.25rem 0.5rem;border-radius:4px">
                Viewport: ${clicks[0]?.viewportWidth || '?'}x${clicks[0]?.viewportHeight || '?'}
              </div>
            </div>
            ` : ''}

            <h4 style="margin-bottom:0.75rem;font-size:0.875rem;color:var(--muted)">Session Journey</h4>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1.5rem;flex-wrap:wrap">
              ${pageviews.map((p, i) => `
                <div style="background:var(--bg);border:1px solid var(--border);padding:0.5rem 0.75rem;border-radius:6px;font-size:0.75rem">
                  <div style="color:var(--text)">${p.path}</div>
                  <div style="color:var(--muted);font-size:0.6875rem">${new Date(p.timestamp).toLocaleTimeString()}</div>
                </div>
                ${i < pageviews.length - 1 ? '<span style="color:var(--muted)">→</span>' : ''}
              `).join('')}
            </div>

            <h4 style="margin-bottom:0.75rem;font-size:0.875rem;color:var(--muted)">Timeline (${timeline.length} events)</h4>
            <div class="timeline" style="max-height:300px;overflow-y:auto">
              ${timeline.map(t => `
                <div class="timeline-item">
                  <div class="timeline-type ${t.type === 'error' ? 'error' : ''}">${t.type}</div>
                  <div class="timeline-content">
                    ${t.type === 'pageview' ? '<span style="color:var(--accent)">' + t.data.path + '</span>' : ''}
                    ${t.type === 'event' ? '<span style="color:var(--success)">' + t.data.name + '</span>' : ''}
                    ${t.type === 'click' ? 'Click at (' + t.data.viewportX + ', ' + t.data.viewportY + ') on <code>' + (t.data.elementTag || 'element') + '</code>' : ''}
                    ${t.type === 'vital' ? '<span style="color:var(--warning)">' + t.data.metric + '</span>: ' + t.data.value + 'ms (' + t.data.rating + ')' : ''}
                    ${t.type === 'error' ? '<span style="color:var(--error)">' + (t.data.message || '').slice(0,100) + '</span>' : ''}
                  </div>
                  <div class="timeline-time">${new Date(t.timestamp).toLocaleTimeString()}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `
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
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted)">No clicks on this page</div>'
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

      const getColor = (v) => {
        if (!v || v.samples === 0) return ''
        if (v.good >= 75) return 'good'
        if (v.poor >= 25) return 'poor'
        return 'needs-improvement'
      }
      const formatValue = (metric, value) => {
        if (metric === 'CLS') return (value / 1000).toFixed(3)
        return value + 'ms'
      }
      tabContent.innerHTML = `
        <div style="grid-column:1/-1">
          ${perfBudgetViolations.length > 0 ? `
            <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:1rem;margin-bottom:1.5rem">
              <h4 style="font-size:0.875rem;color:#ef4444;margin-bottom:0.75rem;display:flex;align-items:center;gap:0.5rem">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                Performance Budget Violations
              </h4>
              <div style="display:flex;flex-wrap:wrap;gap:0.75rem">
                ${perfBudgetViolations.map(v => `
                  <div style="background:var(--bg);border-radius:6px;padding:0.5rem 0.75rem;font-size:0.8125rem">
                    <strong>${v.metric}</strong>: ${v.currentValue}${v.metric === 'CLS' ? '' : 'ms'}
                    <span style="color:#ef4444">(exceeds ${v.threshold}${v.metric === 'CLS' ? '' : 'ms'} by ${v.exceededBy}${v.metric === 'CLS' ? '' : 'ms'})</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          <h3 style="margin-bottom:1rem;font-size:1rem">Core Web Vitals</h3>
          <div class="vitals-grid">
            ${vitals.map(v => `
              <div class="vital-card">
                <div class="vital-name">${v.metric}</div>
                <div class="vital-value ${getColor(v)}">${v.samples > 0 ? formatValue(v.metric, v.p75) : '—'}</div>
                <div style="font-size:0.6875rem;color:var(--muted)">${v.samples} samples</div>
                ${v.samples > 0 ? `
                  <div class="vital-bar">
                    <span class="good" style="width:${v.good}%"></span>
                    <span class="needs-improvement" style="width:${v.needsImprovement}%"></span>
                    <span class="poor" style="width:${v.poor}%"></span>
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
          <p style="margin-top:1rem;font-size:0.75rem;color:var(--muted)">
            <strong>LCP</strong> (Largest Contentful Paint): Loading performance. <strong>FID</strong> (First Input Delay): Interactivity.
            <strong>CLS</strong> (Cumulative Layout Shift): Visual stability. <strong>TTFB</strong> (Time to First Byte): Server response.
            <strong>INP</strong> (Interaction to Next Paint): Responsiveness.
          </p>
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

      const severityColors = { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#65a30d' }
      const severityGradients = {
        critical: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
        high: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
        medium: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
        low: 'linear-gradient(135deg, #65a30d 0%, #4d7c0f 100%)'
      }
      const severityLabels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
      const statusColors = { new: '#3b82f6', resolved: '#22c55e', ignored: '#6b7280', regression: '#f59e0b' }
      const statusLabels = { new: 'New', resolved: 'Resolved', ignored: 'Ignored', regression: 'Regression' }

      // Generate error ID from message for linking
      function getErrorId(msg) {
        return btoa(msg || '').slice(0, 20)
      }

      // Get status for error
      function getErrorStatus(msg) {
        const id = getErrorId(msg)
        return errorStatuses[id]?.status || 'new'
      }

      // Filter errors by status
      const filteredErrors = errorStatusFilter === 'all'
        ? errors
        : errors.filter(e => getErrorStatus(e.message) === errorStatusFilter)

      // Count by status
      const statusCounts = { new: 0, resolved: 0, ignored: 0 }
      errors.forEach(e => {
        const status = getErrorStatus(e.message)
        if (statusCounts[status] !== undefined) statusCounts[status]++
        else statusCounts.new++
      })

      tabContent.innerHTML = `
        <div style="grid-column:1/-1">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem">
            <h3 style="font-size:1.125rem;font-weight:600">JavaScript Errors</h3>
            <div style="display:flex;align-items:center;gap:0.75rem">
              <select class="filter-select" style="width:auto;font-size:0.75rem" onchange="errorStatusFilter=this.value;renderErrors()">
                <option value="all" ${errorStatusFilter === 'all' ? 'selected' : ''}>All (${errors.length})</option>
                <option value="new" ${errorStatusFilter === 'new' ? 'selected' : ''}>New (${statusCounts.new})</option>
                <option value="resolved" ${errorStatusFilter === 'resolved' ? 'selected' : ''}>Resolved (${statusCounts.resolved})</option>
                <option value="ignored" ${errorStatusFilter === 'ignored' ? 'selected' : ''}>Ignored (${statusCounts.ignored})</option>
              </select>
              ${statusCounts.new > 0 ? `
                <button onclick="bulkResolveErrors()" class="export-btn" style="padding:0.25rem 0.5rem;font-size:0.6875rem;background:#22c55e22;border-color:#22c55e;color:#22c55e">✓ Resolve All New</button>
                <button onclick="bulkIgnoreErrors()" class="export-btn" style="padding:0.25rem 0.5rem;font-size:0.6875rem">Ignore All New</button>
              ` : ''}
              <span style="font-size:0.875rem;color:var(--muted)">${filteredErrors.length} error${filteredErrors.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          <!-- Severity summary cards -->
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem">
            <div style="background:rgba(220,38,38,0.1);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:1rem;text-align:center">
              <div style="font-size:2rem;font-weight:700;color:#dc2626">${filteredErrors.filter(e => e.severity === 'critical').length}</div>
              <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em">Critical</div>
            </div>
            <div style="background:rgba(234,88,12,0.1);border:1px solid rgba(234,88,12,0.3);border-radius:8px;padding:1rem;text-align:center">
              <div style="font-size:2rem;font-weight:700;color:#ea580c">${filteredErrors.filter(e => e.severity === 'high').length}</div>
              <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em">High</div>
            </div>
            <div style="background:rgba(217,119,6,0.1);border:1px solid rgba(217,119,6,0.3);border-radius:8px;padding:1rem;text-align:center">
              <div style="font-size:2rem;font-weight:700;color:#d97706">${filteredErrors.filter(e => e.severity === 'medium').length}</div>
              <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em">Medium</div>
            </div>
            <div style="background:rgba(101,163,13,0.1);border:1px solid rgba(101,163,13,0.3);border-radius:8px;padding:1rem;text-align:center">
              <div style="font-size:2rem;font-weight:700;color:#65a30d">${filteredErrors.filter(e => e.severity === 'low').length}</div>
              <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em">Low</div>
            </div>
          </div>

          <!-- Error list -->
          ${filteredErrors.length === 0 ? `
            <div style="text-align:center;padding:3rem;color:var(--muted)">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 1rem;opacity:0.5"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <div style="font-size:1rem;margin-bottom:0.5rem">${errorStatusFilter === 'all' ? 'No errors recorded' : 'No ' + errorStatusFilter + ' errors'}</div>
              <div style="font-size:0.875rem">${errorStatusFilter === 'all' ? 'Your application is running smoothly!' : 'Try a different filter.'}</div>
            </div>
          ` : filteredErrors.map(e => {
            const errorId = getErrorId(e.message)
            const status = getErrorStatus(e.message)
            return `
            <div style="position:relative;margin-bottom:1rem">
              <a href="/errors/${encodeURIComponent(errorId)}?siteId=${siteId}" style="text-decoration:none;color:inherit;display:block">
                <div class="error-card" style="border-left:4px solid ${severityColors[e.severity] || '#6b7280'};cursor:pointer;transition:all 0.15s;${status === 'resolved' ? 'opacity:0.6;' : ''}${status === 'ignored' ? 'opacity:0.4;' : ''}" onmouseover="this.style.transform='translateX(4px)';this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'" onmouseout="this.style.transform='none';this.style.boxShadow='none'">
                  <!-- Error header with gradient -->
                  <div style="background:${severityGradients[e.severity] || severityGradients.medium};margin:-1rem -1rem 1rem -1rem;padding:1rem;border-radius:8px 8px 0 0">
                    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
                      <span style="background:rgba(255,255,255,0.2);color:white;font-size:0.6875rem;padding:0.1875rem 0.5rem;border-radius:9999px;text-transform:uppercase;font-weight:600;letter-spacing:0.05em">${severityLabels[e.severity] || 'Unknown'}</span>
                      <span style="background:rgba(0,0,0,0.2);color:rgba(255,255,255,0.9);font-size:0.6875rem;padding:0.1875rem 0.5rem;border-radius:9999px">${e.category || 'Error'}</span>
                      <span style="background:${statusColors[status]};color:white;font-size:0.6875rem;padding:0.1875rem 0.5rem;border-radius:9999px;text-transform:uppercase">${statusLabels[status] || 'New'}</span>
                      <span style="margin-left:auto;color:rgba(255,255,255,0.75);font-size:0.75rem">${e.count} event${e.count !== 1 ? 's' : ''}</span>
                    </div>
                    <div style="color:white;font-size:0.8125rem;opacity:0.8">${e.source ? e.source.split('/').pop() + ':' + e.line : 'Unknown source'}</div>
                  </div>

                  <!-- Error message -->
                  <div style="font-size:0.9375rem;font-weight:500;color:var(--text);margin-bottom:0.75rem;line-height:1.5">${e.message || 'Unknown error'}</div>

                  <!-- Error metadata -->
                  <div style="display:flex;flex-wrap:wrap;gap:1rem;font-size:0.8125rem;color:var(--muted)">
                    <div style="display:flex;align-items:center;gap:0.375rem">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      First: ${e.firstSeen ? new Date(e.firstSeen).toLocaleDateString() : 'N/A'}
                    </div>
                    <div style="display:flex;align-items:center;gap:0.375rem">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      Last: ${new Date(e.lastSeen).toLocaleString()}
                    </div>
                    <div style="display:flex;align-items:center;gap:0.375rem">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                      ${(e.browsers || []).join(', ') || 'Unknown'}
                    </div>
                    <div style="display:flex;align-items:center;gap:0.375rem">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9"/></svg>
                      ${(e.paths || []).length} page${(e.paths || []).length !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <!-- Actions and link -->
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border)">
                    <div style="display:flex;gap:0.5rem" onclick="event.stopPropagation()">
                      ${status !== 'resolved' ? `<button onclick="updateErrorStatus('${encodeURIComponent(errorId)}', 'resolved', event)" class="export-btn" style="padding:0.25rem 0.5rem;font-size:0.6875rem;background:#22c55e22;border-color:#22c55e;color:#22c55e">✓ Resolve</button>` : ''}
                      ${status !== 'ignored' ? `<button onclick="updateErrorStatus('${encodeURIComponent(errorId)}', 'ignored', event)" class="export-btn" style="padding:0.25rem 0.5rem;font-size:0.6875rem">Ignore</button>` : ''}
                      ${status !== 'new' ? `<button onclick="updateErrorStatus('${encodeURIComponent(errorId)}', 'new', event)" class="export-btn" style="padding:0.25rem 0.5rem;font-size:0.6875rem">Reopen</button>` : ''}
                    </div>
                    <div style="color:var(--accent);font-size:0.8125rem;display:flex;align-items:center">
                      View details
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:0.25rem"><path d="M9 18l6-6-6-6"/></svg>
                    </div>
                  </div>
                </div>
              </a>
            </div>
          `}).join('')}
        </div>
      `
    }

    // Render insights
    function renderInsights() {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return
      const icons = {
        traffic: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>',
        referrer: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101"/></svg>',
        page: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
        device: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>',
        engagement: '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>'
      }
      tabContent.innerHTML = `
        <div style="grid-column:1/-1">
          <h3 style="margin-bottom:1rem;font-size:1rem">Insights</h3>
          ${comparisonStats ? `
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem">
              <div class="stat" style="padding:1rem">
                <div class="stat-val" style="font-size:1.25rem">${fmt(comparisonStats.thisWeekViews)}</div>
                <div class="stat-lbl">Views This Week</div>
                ${comparisonStats.change !== 0 ? '<div class="stat-change ' + (comparisonStats.change > 0 ? 'positive' : 'negative') + '">' + (comparisonStats.change > 0 ? '+' : '') + comparisonStats.change + '%</div>' : ''}
              </div>
              <div class="stat" style="padding:1rem">
                <div class="stat-val" style="font-size:1.25rem">${fmt(comparisonStats.lastWeekViews)}</div>
                <div class="stat-lbl">Views Last Week</div>
              </div>
              <div class="stat" style="padding:1rem">
                <div class="stat-val" style="font-size:1.25rem">${comparisonStats.sessions || 0}</div>
                <div class="stat-lbl">Sessions</div>
              </div>
              <div class="stat" style="padding:1rem">
                <div class="stat-val" style="font-size:1.25rem">${comparisonStats.bounceRate || 0}%</div>
                <div class="stat-lbl">Bounce Rate</div>
              </div>
            </div>
          ` : ''}
          ${insights.length === 0 ? '<div class="empty-cell">No insights available yet. Check back when you have more data.</div>' : insights.map(i => `
            <div class="insight-card">
              <div class="insight-icon ${i.severity}">${icons[i.type] || icons.traffic}</div>
              <div class="insight-content">
                <div class="insight-title">${i.title}</div>
                <div class="insight-desc">${i.description}</div>
              </div>
            </div>
          `).join('')}
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

      tabContent.innerHTML = `
        <div style="grid-column:1/-1">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h3 style="font-size:1rem;display:flex;align-items:center;gap:0.5rem">
              <span class="pulse"></span>
              Live Activity
            </h3>
            <span style="font-size:0.75rem;color:var(--muted)">Auto-refreshing every 5s</span>
          </div>
          ${liveActivities.length === 0 ? `
            <div class="empty-cell">No recent activity. Visitors will appear here in real-time.</div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:0.5rem">
              ${liveActivities.map(a => `
                <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:0.75rem 1rem;display:flex;align-items:center;gap:1rem">
                  <div style="width:8px;height:8px;background:var(--success);border-radius:50%"></div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:0.875rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.path || '/'}</div>
                    <div style="font-size:0.6875rem;color:var(--muted)">${a.country || 'Unknown'} • ${a.device || 'Unknown'} • ${a.browser || 'Unknown'}</div>
                  </div>
                  <div style="font-size:0.6875rem;color:var(--muted);white-space:nowrap">${timeAgo(a.timestamp)}</div>
                </div>
              `).join('')}
            </div>
          `}
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

      tabContent.innerHTML = `
        <div style="grid-column:1/-1">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h3 style="font-size:1rem">Conversion Funnels</h3>
            <button class="export-btn" onclick="showCreateFunnelModal()" style="padding:0.5rem 1rem">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              New Funnel
            </button>
          </div>
          ${funnels.length === 0 ? `
            <div class="empty-cell">
              <p>No funnels configured yet.</p>
              <p style="font-size:0.75rem;color:var(--muted);margin-top:0.5rem">Create a funnel to track conversion rates through your key user flows.</p>
            </div>
          ` : funnels.map(f => `
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:0.75rem">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
                <h4 style="font-size:0.875rem">${f.name}</h4>
                <button class="icon-btn" onclick="analyzeFunnel('${f.id}')" title="View analysis">
                  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                </button>
              </div>
              <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
                ${(f.steps || []).map((s, i) => `
                  <span style="font-size:0.6875rem;padding:0.25rem 0.5rem;background:var(--bg);border-radius:4px">${i + 1}. ${s.name}</span>
                `).join('<span style="color:var(--accent)">→</span>')}
              </div>
            </div>
          `).join('')}
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

    function showFunnelAnalysis(data) {
      const tabContent = document.getElementById('tab-content')
      if (!tabContent) return

      const { funnel, steps, totalSessions, overallConversion } = data

      tabContent.innerHTML = `
        <div style="grid-column:1/-1">
          <button onclick="fetchFunnels()" style="background:none;border:none;color:var(--muted);cursor:pointer;margin-bottom:1rem;font-size:0.8125rem">← Back to Funnels</button>
          <h3 style="font-size:1rem;margin-bottom:0.5rem">${funnel.name}</h3>
          <p style="font-size:0.75rem;color:var(--muted);margin-bottom:1.5rem">${totalSessions} sessions analyzed • ${overallConversion}% overall conversion</p>

          <div style="display:flex;gap:0.5rem;align-items:stretch">
            ${steps.map((s, i) => `
              <div style="flex:1;text-align:center">
                <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:0.5rem">
                  <div style="font-size:1.5rem;font-weight:600;color:var(--text)">${s.visitors}</div>
                  <div style="font-size:0.6875rem;color:var(--muted);margin-top:0.25rem">${s.conversionRate}% of total</div>
                </div>
                <div style="font-size:0.75rem;font-weight:500">${s.name}</div>
                ${i > 0 ? '<div style="font-size:0.6875rem;color:var(--error);margin-top:0.25rem">↓ ' + s.dropoffRate + '% drop</div>' : ''}
              </div>
              ${i < steps.length - 1 ? '<div style="display:flex;align-items:center;color:var(--muted);font-size:1.5rem">→</div>' : ''}
            `).join('')}
          </div>
        </div>
      `
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
    let settingsData = {}

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

      tabContent.innerHTML = `
        <div style="grid-column:1/-1">
          <h3 style="font-size:1rem;margin-bottom:1.5rem">Settings</h3>

          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1rem">
            <!-- Left Column -->
            <div>
              <!-- API Keys -->
              <div class="panel" style="margin-bottom:1rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
                  <h4 style="font-size:0.875rem">API Keys</h4>
                  <button class="export-btn" onclick="createApiKey()" style="padding:0.375rem 0.75rem;font-size:0.75rem">+ New Key</button>
                </div>
                <p style="font-size:0.75rem;color:var(--muted);margin-bottom:0.75rem">Generate API keys for programmatic access to your analytics data.</p>
                ${(apiKeys.apiKeys || []).length === 0 ? `
                  <p style="font-size:0.75rem;color:var(--muted);font-style:italic">No API keys yet.</p>
                ` : `
                  <div style="display:flex;flex-direction:column;gap:0.5rem">
                    ${(apiKeys.apiKeys || []).map(k => `
                      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;background:var(--bg);border-radius:4px">
                        <div>
                          <div style="font-size:0.8125rem;font-weight:500">${k.name || 'API Key'}</div>
                          <code style="font-size:0.6875rem;color:var(--muted)">${k.key}</code>
                        </div>
                        <button class="icon-btn danger" onclick="deleteApiKey('${k.key}')">×</button>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>

              <!-- Alerts -->
              <div class="panel" style="margin-bottom:1rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
                  <h4 style="font-size:0.875rem">Alerts</h4>
                  <button class="export-btn" onclick="createAlert()" style="padding:0.375rem 0.75rem;font-size:0.75rem">+ New Alert</button>
                </div>
                <p style="font-size:0.75rem;color:var(--muted);margin-bottom:0.75rem">Get notified on traffic spikes, drops, or error rate changes.</p>
                ${(alerts.alerts || []).length === 0 ? `
                  <p style="font-size:0.75rem;color:var(--muted);font-style:italic">No alerts configured.</p>
                ` : `
                  <div style="display:flex;flex-direction:column;gap:0.5rem">
                    ${(alerts.alerts || []).map(a => `
                      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;background:var(--bg);border-radius:4px">
                        <div>
                          <div style="font-size:0.8125rem;font-weight:500">${a.name}</div>
                          <div style="font-size:0.6875rem;color:var(--muted)">${a.type} • >${a.threshold}%</div>
                        </div>
                        <button class="icon-btn danger" onclick="deleteAlert('${a.id}')">×</button>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>

              <!-- Uptime Monitoring -->
              <div class="panel" style="margin-bottom:1rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
                  <h4 style="font-size:0.875rem">Uptime Monitoring</h4>
                  <button class="export-btn" onclick="createUptimeMonitor()" style="padding:0.375rem 0.75rem;font-size:0.75rem">+ Add Monitor</button>
                </div>
                <p style="font-size:0.75rem;color:var(--muted);margin-bottom:0.75rem">Monitor endpoint availability and response times.</p>
                ${(uptime.monitors || []).length === 0 ? `
                  <p style="font-size:0.75rem;color:var(--muted);font-style:italic">No monitors configured.</p>
                ` : `
                  <div style="display:flex;flex-direction:column;gap:0.5rem">
                    ${(uptime.monitors || []).map(m => `
                      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;background:var(--bg);border-radius:4px">
                        <div>
                          <div style="font-size:0.8125rem;font-weight:500">${m.url}</div>
                          <div style="font-size:0.6875rem;color:var(--muted)">Every ${m.interval} min</div>
                        </div>
                        <button class="icon-btn danger" onclick="deleteUptimeMonitor('${m.id}')">×</button>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>

              <!-- Performance Budgets -->
              <div class="panel" style="margin-bottom:1rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
                  <h4 style="font-size:0.875rem">Performance Budgets</h4>
                  <button class="export-btn" onclick="createPerfBudget()" style="padding:0.375rem 0.75rem;font-size:0.75rem">+ Add Budget</button>
                </div>
                <p style="font-size:0.75rem;color:var(--muted);margin-bottom:0.75rem">Set thresholds for Core Web Vitals and get alerts when exceeded.</p>
                ${(perfBudgets.budgets || []).length === 0 ? `
                  <p style="font-size:0.75rem;color:var(--muted);font-style:italic">No budgets configured.</p>
                ` : `
                  <div style="display:flex;flex-direction:column;gap:0.5rem">
                    ${(perfBudgets.budgets || []).map(b => `
                      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;background:var(--bg);border-radius:4px">
                        <div>
                          <div style="font-size:0.8125rem;font-weight:500">${b.metric}</div>
                          <div style="font-size:0.6875rem;color:var(--muted)">Max: ${b.threshold}${b.metric === 'CLS' ? '' : 'ms'}</div>
                        </div>
                        <button class="icon-btn danger" onclick="deletePerfBudget('${b.id}')">×</button>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>
            </div>

            <!-- Right Column -->
            <div>
              <!-- Data Retention -->
              <div class="panel" style="margin-bottom:1rem">
                <h4 style="font-size:0.875rem;margin-bottom:0.75rem">Data Retention</h4>
                <p style="font-size:0.75rem;color:var(--muted);margin-bottom:0.75rem">Configure how long to keep analytics data.</p>
                <select id="retention-select" class="filter-select" style="width:auto" onchange="updateRetention(this.value)">
                  <option value="30" ${retention.retentionDays === 30 ? 'selected' : ''}>30 days</option>
                  <option value="90" ${retention.retentionDays === 90 ? 'selected' : ''}>90 days</option>
                  <option value="180" ${retention.retentionDays === 180 ? 'selected' : ''}>180 days</option>
                  <option value="365" ${retention.retentionDays === 365 ? 'selected' : ''}>1 year</option>
                  <option value="730" ${retention.retentionDays === 730 ? 'selected' : ''}>2 years</option>
                </select>
              </div>

              <!-- Team Members -->
              <div class="panel" style="margin-bottom:1rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
                  <h4 style="font-size:0.875rem">Team Members</h4>
                  <button class="export-btn" onclick="inviteTeamMember()" style="padding:0.375rem 0.75rem;font-size:0.75rem">Invite</button>
                </div>
                ${(team.members || []).length === 0 ? `
                  <p style="font-size:0.75rem;color:var(--muted)">No team members yet.</p>
                ` : `
                  <div style="display:flex;flex-direction:column;gap:0.5rem">
                    ${(team.members || []).map(m => `
                      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;background:var(--bg);border-radius:4px">
                        <span style="font-size:0.8125rem">${m.email}</span>
                        <span style="font-size:0.6875rem;color:var(--muted)">${m.role} • ${m.status}</span>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>

              <!-- Webhooks -->
              <div class="panel" style="margin-bottom:1rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
                  <h4 style="font-size:0.875rem">Webhooks (Slack/Discord)</h4>
                  <button class="export-btn" onclick="addWebhook()" style="padding:0.375rem 0.75rem;font-size:0.75rem">Add</button>
                </div>
                ${(webhooks.webhooks || []).length === 0 ? `
                  <p style="font-size:0.75rem;color:var(--muted)">No webhooks configured. Add a Slack or Discord webhook to receive alerts.</p>
                ` : `
                  <div style="display:flex;flex-direction:column;gap:0.5rem">
                    ${(webhooks.webhooks || []).map(w => `
                      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;background:var(--bg);border-radius:4px">
                        <span style="font-size:0.8125rem">${w.type} • ${w.url.slice(0,30)}...</span>
                        <button class="icon-btn danger" onclick="deleteWebhook('${w.id}')">×</button>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>

              <!-- Email Reports -->
              <div class="panel" style="margin-bottom:1rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
                  <h4 style="font-size:0.875rem">Email Reports</h4>
                  <button class="export-btn" onclick="addEmailReport()" style="padding:0.375rem 0.75rem;font-size:0.75rem">Add</button>
                </div>
                ${(emailReports.reports || []).length === 0 ? `
                  <p style="font-size:0.75rem;color:var(--muted)">No email reports scheduled.</p>
                ` : `
                  <div style="display:flex;flex-direction:column;gap:0.5rem">
                    ${(emailReports.reports || []).map(r => `
                      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;background:var(--bg);border-radius:4px">
                        <span style="font-size:0.8125rem">${r.email} • ${r.frequency}</span>
                        <button class="icon-btn danger" onclick="deleteEmailReport('${r.id}')">×</button>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>

              <!-- GDPR -->
              <div class="panel">
                <h4 style="font-size:0.875rem;margin-bottom:0.75rem">GDPR Tools</h4>
                <p style="font-size:0.75rem;color:var(--muted);margin-bottom:0.75rem">Handle data export and deletion requests.</p>
                <div style="display:flex;gap:0.5rem">
                  <button class="export-btn" onclick="gdprExport()" style="padding:0.375rem 0.75rem;font-size:0.75rem">Export Data</button>
                  <button class="export-btn" onclick="gdprDelete()" style="padding:0.375rem 0.75rem;font-size:0.75rem;border-color:var(--error);color:var(--error)">Delete Data</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `
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

      // Render tables
      document.getElementById('pages-body').innerHTML = pages.length
        ? pages.slice(0,10).map(p => {
            const pageUrl = siteHostname ? `https://${siteHostname}${p.path}` : p.path
            const linkHtml = siteHostname
              ? `<a href="${pageUrl}" target="_blank" rel="noopener" class="page-link" title="Visit ${pageUrl}">${p.path}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:4px;opacity:0.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg></a>`
              : p.path
            return `<tr><td class="name" title="${p.path}">${linkHtml}</td><td class="value">${fmt(p.entries||0)}</td><td class="value">${fmt(p.visitors||0)}</td><td class="value">${fmt(p.views||0)}</td></tr>`
          }).join('')
        : '<tr><td colspan="4" class="empty-cell">No page data</td></tr>'

      document.getElementById('referrers-body').innerHTML = referrers.length
        ? referrers.slice(0,10).map(r => {
            const source = r.source || 'Direct'
            const sourceLower = source.toLowerCase()
            const isLink = sourceLower !== 'direct' && !source.includes('(') && source.includes('.')
            const domain = source.replace(/^https?:\/\//, '').split('/')[0]
            const favicon = isLink ? `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=16" width="14" height="14" style="vertical-align:middle;margin-right:6px;border-radius:2px" onerror="this.style.display='none'">` : ''
            const linkHtml = isLink
              ? `<a href="${source.startsWith('http') ? source : 'https://' + source}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:4px">${favicon}${source}<svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="opacity:0.5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>`
              : source
            return `<tr><td class="name">${linkHtml}</td><td class="value">${fmt(r.visitors||0)}</td><td class="value">${fmt(r.views||0)}</td></tr>`
          }).join('')
        : '<tr><td colspan="3" class="empty-cell">No referrer data</td></tr>'

      document.getElementById('devices-body').innerHTML = deviceTypes.length
        ? deviceTypes.map(d => `<tr><td class="name">${getDeviceIcon(d.type)}${d.type}</td><td class="value">${fmt(d.visitors||0)}</td><td class="value">${d.percentage || 0}%</td></tr>`).join('')
        : '<tr><td colspan="3" class="empty-cell">No device data</td></tr>'

      document.getElementById('browsers-body').innerHTML = browsers.length
        ? browsers.slice(0,8).map(b => `<tr><td class="name">${getBrowserIcon(b.name)}${b.name}</td><td class="value">${fmt(b.visitors||0)}</td><td class="value">${b.percentage || 0}%</td></tr>`).join('')
        : '<tr><td colspan="3" class="empty-cell">No browser data</td></tr>'

      document.getElementById('countries-body').innerHTML = countries.length
        ? countries.slice(0,8).map(c => `<tr><td class="name"><span style="margin-right:6px">${getCountryFlag(c.name)}</span>${c.name || c.code || 'Unknown'}</td><td class="value">${fmt(c.visitors||0)}</td></tr>`).join('')
        : '<tr><td colspan="2" class="empty-cell">No location data</td></tr>'

      document.getElementById('campaigns-body').innerHTML = campaigns.length
        ? campaigns.slice(0,8).map(c => `<tr><td class="name">${c.name || c.source || 'Unknown'}</td><td class="value">${fmt(c.visitors||0)}</td><td class="value">${fmt(c.views||0)}</td></tr>`).join('')
        : '<tr><td colspan="3" class="empty-cell">No campaign data</td></tr>'

      // Enhanced events display with mini chart
      const totalEventCount = events.reduce((sum, e) => sum + (e.count || 0), 0)
      const maxEventCount = Math.max(...events.map(e => e.count || 0), 1)
      document.getElementById('events-container').innerHTML = events.length
        ? `<div style="display:flex;flex-direction:column;gap:0.5rem">${events.slice(0,8).map(e => {
            const pct = Math.round(((e.count || 0) / totalEventCount) * 100)
            const barWidth = Math.round(((e.count || 0) / maxEventCount) * 100)
            return `<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.8125rem">
              <div style="flex:1;min-width:0">
                <div style="display:flex;justify-content:space-between;margin-bottom:2px">
                  <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.name}</span>
                  <span style="color:var(--muted);margin-left:0.5rem">${pct}%</span>
                </div>
                <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">
                  <div style="height:100%;width:${barWidth}%;background:var(--accent2);border-radius:2px;transition:width 0.3s"></div>
                </div>
              </div>
              <span style="min-width:50px;text-align:right;font-weight:600">${fmt(e.count||0)}</span>
            </div>`
          }).join('')}</div>`
        : '<div class="empty-cell" style="padding:1rem">No custom events tracked</div>'

      renderChart()
      renderGoals()
    }

    function renderGoals() {
      const container = document.getElementById('goals-container')
      if (!container) return

      if (!goals.length) {
        container.innerHTML = '<div class="empty-cell" style="padding:1rem">No goals configured. Click "+ Add Goal" to create one.</div>'
        return
      }

      container.innerHTML = `
        <table class="data-table">
          <thead><tr>
            <th>Goal</th>
            <th>Type</th>
            <th style="text-align:right">Conversions</th>
            <th style="text-align:right">Value</th>
            <th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>
            ${goals.map(g => `
              <tr>
                <td class="name">${g.name}</td>
                <td><span class="goal-type-badge ${g.type}">${g.type}</span></td>
                <td class="value">${fmt(g.conversions || 0)}</td>
                <td class="value">${g.totalValue ? '$' + g.totalValue.toFixed(2) : '-'}</td>
                <td class="value">
                  <button onclick="editGoal('${g.id}')" class="icon-btn" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button onclick="deleteGoal('${g.id}')" class="icon-btn danger" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
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
        const date = new Date(dateStr)
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
        const date = new Date(dateStr)
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

    document.addEventListener('DOMContentLoaded', () => {
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

        fetchDashboardData()
        refreshInterval = setInterval(fetchDashboardData, 30000)

        // Handle initial tab from URL (e.g., /dashboard/sessions?siteId=xxx)
        const initialTab = getTabFromUrl()
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
  </script>
