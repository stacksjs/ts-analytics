#!/usr/bin/env bun
/**
 * Analytics CLI
 *
 * Command-line interface for managing analytics.
 *
 * Usage:
 *   analytics setup           - Print setup instructions
 *   analytics create-table    - Generate create table command
 *   analytics docker-compose  - Generate docker-compose.yml
 *   analytics seed            - Generate seed data
 *   analytics tracking-script - Generate tracking script
 */

import {
  defineConfig,
  generateAwsCliCommand,
  generateDockerCompose,
  generateLocalCreateTableInput,
  generateSeedData,
  generateTrackingScript,
  printLocalSetupInstructions,
} from '../src'

const args = process.argv.slice(2)
const command = args[0]

function printHelp(): void {
  console.log(`
Analytics CLI - Privacy-first web analytics toolkit

Usage:
  analytics <command> [options]

Commands:
  setup               Print local development setup instructions
  create-table        Generate AWS CLI command to create DynamoDB table
  docker-compose      Generate docker-compose.yml for local development
  seed [options]      Generate seed data for testing
  tracking-script     Generate tracking script for a site
  help                Show this help message

Options:
  --table-name <name>    Table name (default: AnalyticsTable)
  --region <region>      AWS region (default: us-east-1)
  --port <port>          DynamoDB Local port (default: 8000)
  --site-id <id>         Site ID for tracking script
  --api-endpoint <url>   API endpoint for tracking script
  --sites <n>            Number of sites to seed (default: 1)
  --page-views <n>       Page views per site (default: 100)
  --sessions <n>         Sessions per site (default: 50)
  --days <n>             Days of history (default: 7)

Examples:
  analytics setup
  analytics create-table --table-name MyAnalytics
  analytics docker-compose --port 8001
  analytics seed --sites 3 --page-views 500
  analytics tracking-script --site-id site_001 --api-endpoint https://api.example.com
`)
}

function getArg(name: string, defaultValue?: string): string | undefined {
  const index = args.indexOf(`--${name}`)
  if (index === -1)
    return defaultValue
  return args[index + 1] || defaultValue
}

function getNumericArg(name: string, defaultValue: number): number {
  const value = getArg(name)
  return value ? Number.parseInt(value, 10) : defaultValue
}

async function main(): Promise<void> {
  switch (command) {
    case 'setup':
      printLocalSetupInstructions()
      break

    case 'create-table': {
      const tableName = getArg('table-name', 'AnalyticsTable')!
      const config = defineConfig({
        table: { tableName },
        region: getArg('region', 'us-east-1'),
      })

      console.log('# Create DynamoDB table for analytics\n')
      console.log(generateAwsCliCommand(config))
      console.log('\n# Or use this JSON input:')
      console.log(JSON.stringify(generateLocalCreateTableInput(config), null, 2))
      break
    }

    case 'docker-compose': {
      const port = getNumericArg('port', 8000)
      console.log(generateDockerCompose({ port }))
      break
    }

    case 'seed': {
      const options = {
        sites: getNumericArg('sites', 1),
        pageViewsPerSite: getNumericArg('page-views', 100),
        sessionsPerSite: getNumericArg('sessions', 50),
        daysOfHistory: getNumericArg('days', 7),
      }

      console.log(`Generating seed data:`)
      console.log(`  Sites: ${options.sites}`)
      console.log(`  Page views per site: ${options.pageViewsPerSite}`)
      console.log(`  Sessions per site: ${options.sessionsPerSite}`)
      console.log(`  Days of history: ${options.daysOfHistory}`)
      console.log('')

      const data = generateSeedData(options)

      console.log(`Generated:`)
      console.log(`  ${data.sites.length} sites`)
      console.log(`  ${data.sessions.length} sessions`)
      console.log(`  ${data.pageViews.length} page views`)
      console.log('')
      console.log('// Seed data JSON:')
      console.log(JSON.stringify(data, null, 2))
      break
    }

    case 'tracking-script': {
      const siteId = getArg('site-id')
      const apiEndpoint = getArg('api-endpoint', 'https://api.example.com/analytics')!

      if (!siteId) {
        console.error('Error: --site-id is required')
        console.error('Usage: analytics tracking-script --site-id <id> [--api-endpoint <url>]')
        process.exit(1)
      }

      const script = generateTrackingScript({
        siteId,
        apiEndpoint,
        honorDnt: true,
        trackHashChanges: false,
        trackOutboundLinks: true,
      })

      console.log('<!-- Add this script to your website -->')
      console.log(script)
      break
    }

    case 'help':
    case '--help':
    case '-h':
      printHelp()
      break

    default:
      if (command) {
        console.error(`Unknown command: ${command}`)
      }
      printHelp()
      process.exit(command ? 1 : 0)
  }
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
