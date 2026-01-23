/**
 * Deploy DynamoDB Table for ts-analytics
 *
 * Uses ts-cloud's CloudFormation client to deploy the analytics table.
 */

// Import CloudFormation client directly from ts-cloud source
import { CloudFormationClient } from '../../ts-cloud/packages/ts-cloud/src/aws/cloudformation'
import { generateCloudFormationJson } from '../src/infrastructure/cloudformation'

const TABLE_NAME = process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'
const STACK_NAME = `${TABLE_NAME}-stack`
const REGION = process.env.AWS_REGION || 'us-east-1'

async function deployDynamoDBTable() {
  console.log(`Deploying DynamoDB table: ${TABLE_NAME}`)
  console.log(`Stack name: ${STACK_NAME}`)
  console.log(`Region: ${REGION}`)

  const cfn = new CloudFormationClient(REGION)

  // Generate CloudFormation template
  const template = generateCloudFormationJson({
    stackName: STACK_NAME,
    tableName: TABLE_NAME,
    billingMode: 'PAY_PER_REQUEST',
    enablePitr: true,
    enableEncryption: true,
    ttlAttributeName: 'ttl',
    tags: {
      Project: 'ts-analytics',
      ManagedBy: 'ts-cloud',
    },
  })

  try {
    // Check if stack exists
    let stackExists = false
    let existingStack = null

    try {
      const existingStacks = await cfn.describeStacks({ stackName: STACK_NAME })
      if (existingStacks.Stacks.length > 0) {
        stackExists = true
        existingStack = existingStacks.Stacks[0]
      }
    }
    catch (error: unknown) {
      // Stack doesn't exist - this is expected for new deployments
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (!errorMessage.includes('does not exist')) {
        throw error
      }
      console.log('Stack does not exist yet, will create new stack')
    }

    if (stackExists && existingStack) {
      const stack = existingStack

      if (stack.StackStatus === 'CREATE_COMPLETE' || stack.StackStatus === 'UPDATE_COMPLETE') {
        console.log(`Stack ${STACK_NAME} already exists and is healthy`)
        console.log(`Status: ${stack.StackStatus}`)

        // Get outputs
        const outputs = await cfn.getStackOutputs(STACK_NAME)
        console.log('\nStack outputs:')
        for (const [key, value] of Object.entries(outputs)) {
          console.log(`  ${key}: ${value}`)
        }
        return
      }

      if (stack.StackStatus.endsWith('_IN_PROGRESS')) {
        console.log(`Stack is currently in progress: ${stack.StackStatus}`)
        console.log('Waiting for stack to complete...')
        await cfn.waitForStack(STACK_NAME, 'stack-update-complete')
        return
      }

      // Stack exists but needs update
      console.log(`Updating existing stack: ${STACK_NAME}`)
      try {
        await cfn.updateStack({
          stackName: STACK_NAME,
          templateBody: template,
        })
        console.log('Waiting for stack update to complete...')
        await cfn.waitForStack(STACK_NAME, 'stack-update-complete')
      }
      catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (errorMessage.includes('No updates are to be performed')) {
          console.log('No updates needed - stack is up to date')
        }
        else {
          throw error
        }
      }
    }
    else {
      // Create new stack
      console.log('Creating new CloudFormation stack...')
      await cfn.createStack({
        stackName: STACK_NAME,
        templateBody: template,
        tags: [
          { Key: 'Project', Value: 'ts-analytics' },
          { Key: 'ManagedBy', Value: 'ts-cloud' },
        ],
      })

      console.log('Waiting for stack creation to complete...')
      await cfn.waitForStack(STACK_NAME, 'stack-create-complete')
    }

    // Get outputs
    const outputs = await cfn.getStackOutputs(STACK_NAME)
    console.log('\nDeployment complete!')
    console.log('Stack outputs:')
    for (const [key, value] of Object.entries(outputs)) {
      console.log(`  ${key}: ${value}`)
    }
  }
  catch (error) {
    console.error('Deployment failed:', error)
    process.exit(1)
  }
}

// Run deployment
deployDynamoDBTable()
