export {
  // Types
  type AggregatedStats,
  type AggregationJobStatus,
  type AggregationPeriod,
  AggregationPipeline,
  type AggregatorOptions,
  AnalyticsAggregator,
  AnalyticsKeyPatterns,
  AnalyticsQueryAPI,
  AnalyticsStore,
  type AnalyticsStoreOptions,
  type CampaignStats,
  type Conversion,
  type CustomEvent,
  type DashboardData,
  type DashboardSummary,
  type DateRange,
  type DeviceStats,
  type DeviceType,
  type EventStats,
  generateTrackingScript,
  type GeoStats,
  type Goal,
  GoalMatcher,
  type GoalMatchResult,
  type GoalPerformance,
  type GoalStats,
  type GoalType,
  type PageStats,
  type PageView,
  type PipelineJobConfig,
  type PipelineJobResult,
  type QueryOptions,
  type RealtimeData,
  type RealtimeStats,
  type ReferrerStats,
  type Session,
  type Site,
  type SiteSettings,
  type TimeSeriesPoint,
  type TopItem,
  type TrackingScriptOptions,
} from './Analytics'

// API Handlers
export {
  AnalyticsAPI,
  type AnalyticsAPIConfig,
  type AnalyticsRequest,
  type AnalyticsResponse,
  type CollectPayload,
  createBunRouter,
  createLambdaHandler,
  type HandlerContext,
  type SessionStore,
} from './api'

// Configuration
export {
  type AnalyticsConfig,
  defaultAnalyticsConfig,
  defaultConfig,
  defaultGSIs,
  defaultSingleTableConfig,
  defineConfig,
  getConfig,
  getTableConfig,
  getTtlForEntity,
  resetConfig,
  setConfig,
  type UserAnalyticsConfig,
} from './config'

// Dashboard UI Components
export {
  // Main dashboards
  AnalyticsDashboard,
  FullAnalyticsDashboard,

  // Core components
  StatCard,
  RealtimeCounter,
  ThemeSwitcher,

  // Chart components
  TimeSeriesChart,
  DonutChart,
  BarChart,
  FunnelChart,
  SparklineChart,
  ProgressRing,
  HeatmapChart,
  MetricComparison,

  // Breakdown components
  DeviceBreakdown,
  BrowserBreakdown,
  OSBreakdown,
  CampaignBreakdown,
  CountryList,

  // Data & interaction
  DataTable,
  TopList,
  FilterBar,
  DateRangePicker,
  PageDetailCard,
  GoalsPanel,

  // Real-time & activity
  LiveActivityFeed,
  EngagementMetrics,
  TrendIndicator,
  AnimatedNumber,
  MiniStats,
  EmptyState,

  // Alert
  AlertCard,

  // Composables
  AnalyticsClient,
  createAnalyticsComposable,
  createRealtimePoller,
  fetchDashboardData,
  useAnalytics,

  // Utilities
  calculateAxisTicks,
  calculateChange,
  calculatePercentageChange,
  formatCompact,
  formatDate,
  formatDateRange,
  formatDuration,
  formatNumber,
  formatPercentage,
  getDateRangeFromPreset,
  getDateRangePreset,
  dateRangePresets,

  // Theme
  defaultTheme,
  darkTheme,

  // Types
  type AnalyticsApiConfig,
  type ChartProps,
  type DashboardTheme,
  type DateRangePreset,
  type RealtimeCounterProps,
  type StatCardProps,
  type TimeSeriesDataPoint,
  type TopListProps,
} from './dashboard'

// DynamoDB Utilities
export {
  buildGSI1PK,
  buildPeriodSK,
  buildPK,
  buildSiteQuery,
  buildSK,
  buildTimeRangeQuery,
  buildTimestampKey,
  determinePeriod,
  fromDynamoValue,
  generateId,
  generateSessionId,
  getDailySalt,
  getPeriodStart,
  hashVisitorId,
  KeyPatterns,
  marshal,
  toDynamoValue,
  unmarshal,
} from './dynamodb'

// Infrastructure (CloudFormation, CDK, Setup)
export {
  type AnalyticsApiProps,
  type AnalyticsTableProps,
  checkTableStatus,
  type CloudFormationConfig,
  createAnalyticsTable,
  createPitrMigration,
  createStreamsMigration,
  createTimeBasedGsiMigration,
  type DynamoDBClientLike,
  enableTtl,
  generateAwsCliCommands,
  generateCdkCode,
  generateCdkTableCode,
  generateCloudFormationJson,
  generateCloudFormationTemplate,
  generateCloudFormationYaml,
  generateCreateTableInput,
  generateSamTemplate,
  generateSamYaml,
  type MigrationResult,
  type MigrationStep,
  printSetupInstructions,
  runMigrations,
  type SetupConfig,
  type SetupResult,
} from './infrastructure'

// Local Development
export {
  defaultLocalConfig,
  defaultSeedOptions,
  generateAwsCliCommand,
  generateDockerCompose,
  generateLocalCreateTableInput,
  generateSeedData,
  type LocalDynamoDBConfig,
  printLocalSetupInstructions,
  type SeedDataOptions,
} from './local'

// Model Connector (Single-Table Design Integration)
export {
  type AccessPattern,
  analyticsModelRegistry,
  type EntityDesign,
  generateAccessPatternMatrix,
  generateAnalyticsDesignDoc,
  generateAnalyticsSingleTableDesign,
  getAllAnalyticsModels,
  getAnalyticsModel,
  getAnalyticsModelNames,
  type SingleTableDesign,
  type StacksModelDefinition,
} from './model-connector'

// Stacks Model Definitions
export {
  AggregatedStatsModel,
  type AnalyticsModelName,
  analyticsModels,
  CampaignStatsModel,
  ConversionModel,
  CustomEventModel,
  DeviceStatsModel,
  EventStatsModel,
  GeoStatsModel,
  GoalModel,
  GoalStatsModel,
  PageStatsModel,
  PageViewModel,
  RealtimeStatsModel,
  ReferrerStatsModel,
  SessionModel,
  SiteModel,
} from './models'

// Stacks Integration
export {
  createAnalyticsDriver,
  createAnalyticsMiddleware,
  createDashboardActions,
  createServerTrackingMiddleware,
  type DynamoDBAnalyticsConfig,
  DynamoDBAnalyticsDriver,
  type StacksAnalyticsOptions,
} from './stacks-integration'

// Framework Integrations
export {
  analyticsMiddleware,
  type AnalyticsMiddlewareOptions,
  type CloudflareEnv,
  type CloudflareHandlerOptions,
  createAnalyticsHandler,
  createAnalyticsRoutes,
  createD1Adapter,
  mountAnalyticsRoutes,
  type StorageAdapter,
} from './integrations'

// Batching Utilities
export {
  type BatchItem,
  type BatchQueueOptions,
  type BatchWriteResult,
  chunk,
  createBatchProcessor,
  type DynamoDBBatchClient,
  EventBatchQueue,
  parallelProcess,
  withRetry,
} from './batching'

// Funnel Analysis
export {
  calculateDropOffRate,
  contentEngagementFunnel,
  createFunnel,
  ecommerceCheckoutFunnel,
  formatFunnelReport,
  type Funnel,
  type FunnelAnalysis,
  FunnelAnalyzer,
  type FunnelStep,
  type FunnelStepAnalysis,
  type FunnelStepMatcher,
  identifyDropOffPoints,
  saasSignupFunnel,
  type UserJourney,
} from './funnels'

// Tracking Script Generator
export {
  generateFullTrackingScript,
  generateGA4StyleScript,
  generateInlineTrackingScript,
  generateMinimalTrackingScript,
  generateTrackingSnippet,
  type TrackingScriptConfig,
} from './tracking-script'
