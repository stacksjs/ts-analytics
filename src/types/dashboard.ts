// Dashboard UI types - extracted from component inline definitions

export interface ModalOptions {
  title?: string
  content?: string
  size?: string
  className?: string
  showFooter?: boolean
  submitText?: string
  cancelText?: string
  onSubmit?: (() => Promise<void>) | null
  onCancel?: (() => void) | null
}

export interface ModalAPI {
  open: (options?: ModalOptions) => void
  close: () => void
  handleSubmit: () => Promise<void>
  getFormData: () => Record<string, string | boolean>
  confirm: (message: string, onConfirm: () => Promise<void>) => void
  alert: (title: string, message: string) => void
}

export interface GoalModalAPI {
  openCreate: () => void
  openEdit: (goal: any) => void
  close: () => void
}

export interface NavTab {
  id: string
  label: string
  href: string
}

export interface DashboardHeaderAPI {
  toggleTheme: () => void
  goBack: () => void
  isDarkTheme: () => boolean
}

export interface DateRange {
  id: string
  label: string
}

export interface ControlsBarAPI {
  activeRange: () => string
  showComparison: () => boolean
  realtimeCount: () => number
  lastUpdated: () => string
  isRefreshing: () => boolean
  setRange: (range: string) => void
  toggleComparison: () => void
  refresh: () => Promise<void>
  exportData: (format: string) => void
}

export interface ReferrersTableProps {
  referrers?: import('./analytics').Referrer[]
  loading?: boolean
}
