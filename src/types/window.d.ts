// Window interface augmentation - eliminates (window as any) casts

import type { ModalAPI, GoalModalAPI, DashboardHeaderAPI, ControlsBarAPI } from './dashboard'

export {}

declare global {
  interface Window {
    // Site configuration (set by dashboard.ts / layout scripts)
    siteId: string | undefined
    API_ENDPOINT: string
    ANALYTICS_API: string
    ANALYTICS_API_ENDPOINT: string
    ANALYTICS_SITE_ID: string
    ANALYTICS_STEALTH_MODE: boolean
    USE_STEALTH: boolean

    // API helpers (set by dashboard.ts)
    apiPath: (url: string) => string
    getDateRangeParams: () => string

    // Dashboard controller functions (set by dashboard.ts)
    fetchDashboardData: (() => Promise<void>) | undefined
    refreshAllPanels: (() => void) | undefined
    setDateRange: ((range: string) => void) | undefined
    toggleComparison: (() => void) | undefined
    exportData: ((format: string) => void) | undefined
    dateRange: string | undefined
    navigateTo: ((tab: string) => void) | undefined
    applyFilter: ((type: string, value: string) => void) | undefined

    // Panel refresh functions (set by individual panels)
    refreshGoalsPanel: (() => void) | undefined
    refreshEventsPanel: (() => void) | undefined
    refreshPagesPanel: (() => void) | undefined
    refreshReferrersPanel: (() => void) | undefined
    refreshCountriesPanel: (() => void) | undefined
    refreshBrowsersPanel: (() => void) | undefined
    refreshDevicesPanel: (() => void) | undefined
    refreshCampaignsPanel: (() => void) | undefined

    // Component APIs (set via provide/inject and window exposure)
    goalModal: GoalModalAPI | undefined
    Modal: ModalAPI | undefined
    dashboardHeader: DashboardHeaderAPI | undefined
    controlsBar: ControlsBarAPI | undefined

    // Header bridge functions
    headerSetSiteName: ((name: string) => void) | undefined
    toggleTheme: (() => void) | undefined
    goBack: (() => void) | undefined

    // Controls bar bridge functions
    updateRealtimeCount: ((count: number) => void) | undefined
    updateLastUpdated: ((time: string) => void) | undefined
    controlsSetDateRange: ((range: string) => void) | undefined

    // Filter bar functions
    setFilterCountries: ((countries: string[]) => void) | undefined
    setFilterBrowsers: ((browsers: string[]) => void) | undefined
    getFilterParams: (() => string) | undefined
    resetFilters: (() => void) | undefined

    // FunnelsTab window globals (for modal innerHTML onclick)
    __addFunnelStep: (() => void) | undefined
    __removeFunnelStep: ((index: number) => void) | undefined

    // Legacy goal modal functions (dashboard.ts)
    showEditGoalModal: ((goalId: string) => void) | undefined
    confirmDeleteGoal: ((goalId: string) => void) | undefined

    // Annotation
    addAnnotation: (() => void) | undefined

    // Modal close (SessionModal)
    closeModal: (() => void) | undefined

    // STX runtime
    stx: {
      state: <T>(initial: T) => { (): T; set: (v: T) => void; update: (fn: (v: T) => T) => void }
      derived: <T>(fn: () => T) => () => T
      effect: (fn: () => void | (() => void)) => void
      mount: (el: Element, fn: () => void) => void
      [key: string]: any
    }
    stxRouter: { navigate: (url: string) => void; clearCache: () => void }
    stxLoading: { start: () => void; finish: () => void; show: () => void; hide: () => void }
    STX_ROUTER_OPTIONS: Record<string, any>

    // Composables registry
    __composables: {
      useSiteApi: () => any
      useFetchData: (initialValue?: any) => any
      useFetchMultiple: () => any
      useModal: () => any
    }

    // Tracking script
    sa: ((...args: any[]) => void) & { q?: any[][] }
  }
}
