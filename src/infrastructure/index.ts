/**
 * Analytics Infrastructure Module
 *
 * Provides tools for deploying the analytics DynamoDB table:
 * - CloudFormation templates (JSON/YAML)
 * - SAM templates for serverless deployment
 * - CDK code generation
 * - AWS SDK CreateTable input
 * - Migration utilities
 * - Setup scripts
 */

// CDK
export {
  type AnalyticsApiProps,
  type AnalyticsTableProps,
  generateCdkCode,
  generateCdkTableCode,
  generateCreateTableInput,
} from './cdk'

// CloudFormation
export {
  type CloudFormationConfig,
  generateCloudFormationJson,
  generateCloudFormationTemplate,
  generateCloudFormationYaml,
  generateSamTemplate,
  generateSamYaml,
} from './cloudformation'

// Setup & Migrations
export {
  checkTableStatus,
  createAnalyticsTable,
  createPitrMigration,
  createStreamsMigration,
  createTimeBasedGsiMigration,
  type DynamoDBClientLike,
  enableTtl,
  generateAwsCliCommands,
  type MigrationResult,
  type MigrationStep,
  printSetupInstructions,
  runMigrations,
  type SetupConfig,
  type SetupResult,
} from './setup'
