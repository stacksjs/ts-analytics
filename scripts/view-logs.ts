#!/usr/bin/env bun
/**
 * View Lambda logs using ts-cloud
 */

import { CloudWatchLogsClient } from '../../ts-cloud/packages/ts-cloud/src/aws/cloudwatch-logs'

const FUNCTION_NAME = process.env.API_SERVICE_NAME || 'ts-analytics-api'
const LOG_GROUP = `/aws/lambda/${FUNCTION_NAME}`
const REGION = process.env.AWS_REGION || 'us-east-1'

async function viewLogs() {
  const logs = new CloudWatchLogsClient(REGION)

  console.log(`Fetching logs from ${LOG_GROUP}...\n`)

  try {
    // Get latest log streams
    const streams = await logs.describeLogStreams({
      logGroupName: LOG_GROUP,
      orderBy: 'LastEventTime',
      descending: true,
      limit: 3,
    })

    if (!streams.logStreams?.length) {
      console.log('No log streams found')
      return
    }

    // Get events from the latest stream
    for (const stream of streams.logStreams) {
      console.log(`\n=== Stream: ${stream.logStreamName} ===\n`)

      const events = await logs.getLogEvents({
        logGroupName: LOG_GROUP,
        logStreamName: stream.logStreamName!,
        limit: 50,
        startFromHead: false,
      })

      if (events.events?.length) {
        for (const event of events.events) {
          const time = event.timestamp ? new Date(event.timestamp).toISOString() : ''
          console.log(`[${time}] ${event.message}`)
        }
      } else {
        console.log('No events in this stream')
      }
    }
  } catch (error) {
    console.error('Error fetching logs:', error)
  }
}

viewLogs()
