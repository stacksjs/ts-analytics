#!/usr/bin/env bun
/**
 * Check CloudFormation stack events
 */

import { CloudFormationClient } from '../../ts-cloud/packages/ts-cloud/src/aws/cloudformation'

const STACK_NAME = 'ts-analytics-api-lambda-stack'
const REGION = 'us-east-1'

async function checkStack() {
  const cfn = new CloudFormationClient(REGION)

  console.log(`Checking stack events for ${STACK_NAME}...\n`)

  try {
    const events = await cfn.describeStackEvents(STACK_NAME)

    // Show recent events
    const recentEvents = events.StackEvents?.slice(0, 20) || []
    for (const event of recentEvents) {
      const status = event.ResourceStatus || ''
      const reason = event.ResourceStatusReason || ''
      const resource = event.LogicalResourceId || ''
      const time = event.Timestamp ? new Date(event.Timestamp).toISOString() : ''

      if (status.includes('FAILED') || reason) {
        console.log(`[${time}] ${resource}: ${status}`)
        if (reason) console.log(`  Reason: ${reason}\n`)
      }
    }
  } catch (error) {
    console.error('Error:', error)
  }
}

checkStack()
