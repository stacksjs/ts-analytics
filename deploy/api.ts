/**
 * Deploy Analytics API to AWS
 *
 * Uses ts-cloud to deploy the analytics API using:
 * - ECR for Docker image storage
 * - App Runner for running the container (simpler than ECS)
 * - Route53 for DNS
 */

import { CloudFormationClient } from '../../ts-cloud/packages/ts-cloud/src/aws/cloudformation'
import { ECRClient } from '../../ts-cloud/packages/ts-cloud/src/aws/ecr'
import { Route53Client } from '../../ts-cloud/packages/ts-cloud/src/aws/route53'

const SERVICE_NAME = process.env.API_SERVICE_NAME || 'ts-analytics-api'
const STACK_NAME = `${SERVICE_NAME}-stack`
const REGION = process.env.AWS_REGION || 'us-east-1'
const DOMAIN = process.env.API_DOMAIN || 'analytics-api.stacksjs.com'
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'stacksjs.com'
const TABLE_NAME = process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'

async function deployAPI() {
  console.log('Deploying Analytics API to AWS')
  console.log(`Service: ${SERVICE_NAME}`)
  console.log(`Domain: ${DOMAIN}`)
  console.log(`Region: ${REGION}`)
  console.log(`DynamoDB Table: ${TABLE_NAME}`)

  const cfn = new CloudFormationClient(REGION)
  const ecr = new ECRClient(REGION)
  const route53 = new Route53Client(REGION)

  // Step 1: Create ECR repository if it doesn't exist
  console.log('\n1. Setting up ECR repository...')
  try {
    await ecr.createRepository({
      repositoryName: SERVICE_NAME,
      imageScanningConfiguration: { scanOnPush: true },
      imageTagMutability: 'MUTABLE',
    })
    console.log(`   Created ECR repository: ${SERVICE_NAME}`)
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('already exists')) {
      console.log(`   ECR repository already exists: ${SERVICE_NAME}`)
    }
    else {
      throw error
    }
  }

  // Get ECR repository URI
  const repos = await ecr.describeRepositories({ repositoryNames: [SERVICE_NAME] })
  const repoUri = repos.repositories[0]?.repositoryUri
  if (!repoUri) {
    throw new Error('Failed to get ECR repository URI')
  }
  console.log(`   Repository URI: ${repoUri}`)

  // Step 2: Build and push Docker image
  console.log('\n2. Building and pushing Docker image...')
  const imageTag = `${repoUri}:latest`

  // Create Dockerfile if it doesn't exist
  const dockerfileContent = `FROM oven/bun:1 as base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source files
COPY . .

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Run the server
CMD ["bun", "run", "./server/index.ts"]
`

  await Bun.write('Dockerfile', dockerfileContent)
  console.log('   Created Dockerfile')

  // Get ECR login credentials and build/push
  const authToken = await ecr.getAuthorizationToken()
  if (!authToken.authorizationData?.[0]) {
    throw new Error('Failed to get ECR authorization token')
  }

  const auth = authToken.authorizationData[0]
  const [username, password] = Buffer.from(auth.authorizationToken, 'base64').toString().split(':')
  const registryUri = auth.proxyEndpoint?.replace('https://', '') || ''

  console.log(`   Logging into ECR: ${registryUri}`)

  // Login to ECR
  const loginProc = Bun.spawn(['docker', 'login', '--username', username, '--password-stdin', registryUri], {
    stdin: 'pipe',
  })
  loginProc.stdin.write(password)
  loginProc.stdin.end()
  await loginProc.exited

  // Build image
  console.log('   Building Docker image...')
  const buildProc = Bun.spawn(['docker', 'build', '-t', imageTag, '.'], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await buildProc.exited
  if (buildProc.exitCode !== 0) {
    throw new Error('Docker build failed')
  }

  // Push image
  console.log('   Pushing to ECR...')
  const pushProc = Bun.spawn(['docker', 'push', imageTag], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await pushProc.exited
  if (pushProc.exitCode !== 0) {
    throw new Error('Docker push failed')
  }

  console.log('   Image pushed successfully')

  // Step 3: Deploy App Runner service via CloudFormation
  console.log('\n3. Deploying App Runner service...')

  const template = JSON.stringify({
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'ts-analytics API Server',

    Parameters: {
      ImageUri: {
        Type: 'String',
        Default: imageTag,
      },
      TableName: {
        Type: 'String',
        Default: TABLE_NAME,
      },
    },

    Resources: {
      // IAM Role for App Runner to access ECR
      AppRunnerAccessRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'build.apprunner.amazonaws.com' },
                Action: 'sts:AssumeRole',
              },
            ],
          },
          ManagedPolicyArns: [
            'arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess',
          ],
        },
      },

      // IAM Role for App Runner instance to access DynamoDB
      AppRunnerInstanceRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'tasks.apprunner.amazonaws.com' },
                Action: 'sts:AssumeRole',
              },
            ],
          },
          Policies: [
            {
              PolicyName: 'DynamoDBAccess',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  {
                    Effect: 'Allow',
                    Action: [
                      'dynamodb:GetItem',
                      'dynamodb:PutItem',
                      'dynamodb:UpdateItem',
                      'dynamodb:DeleteItem',
                      'dynamodb:Query',
                      'dynamodb:Scan',
                    ],
                    Resource: [
                      { 'Fn::Sub': 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${TableName}' },
                      { 'Fn::Sub': 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${TableName}/index/*' },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },

      // App Runner Service
      AppRunnerService: {
        Type: 'AWS::AppRunner::Service',
        Properties: {
          ServiceName: SERVICE_NAME,
          SourceConfiguration: {
            AuthenticationConfiguration: {
              AccessRoleArn: { 'Fn::GetAtt': ['AppRunnerAccessRole', 'Arn'] },
            },
            AutoDeploymentsEnabled: true,
            ImageRepository: {
              ImageIdentifier: { Ref: 'ImageUri' },
              ImageRepositoryType: 'ECR',
              ImageConfiguration: {
                Port: '3001',
                RuntimeEnvironmentVariables: [
                  { Name: 'ANALYTICS_TABLE_NAME', Value: { Ref: 'TableName' } },
                  { Name: 'AWS_REGION', Value: { Ref: 'AWS::Region' } },
                  { Name: 'PORT', Value: '3001' },
                  { Name: 'CORS_ORIGINS', Value: '*' },
                ],
              },
            },
          },
          InstanceConfiguration: {
            Cpu: '0.25 vCPU',
            Memory: '0.5 GB',
            InstanceRoleArn: { 'Fn::GetAtt': ['AppRunnerInstanceRole', 'Arn'] },
          },
          HealthCheckConfiguration: {
            Protocol: 'HTTP',
            Path: '/health',
            Interval: 10,
            Timeout: 5,
            HealthyThreshold: 1,
            UnhealthyThreshold: 5,
          },
        },
      },
    },

    Outputs: {
      ServiceUrl: {
        Description: 'App Runner Service URL',
        Value: { 'Fn::GetAtt': ['AppRunnerService', 'ServiceUrl'] },
      },
      ServiceArn: {
        Description: 'App Runner Service ARN',
        Value: { 'Fn::GetAtt': ['AppRunnerService', 'ServiceArn'] },
      },
    },
  })

  try {
    // Check if stack exists
    let stackExists = false
    try {
      const existingStacks = await cfn.describeStacks({ stackName: STACK_NAME })
      stackExists = existingStacks.Stacks.length > 0
    }
    catch {
      // Stack doesn't exist
    }

    if (stackExists) {
      console.log(`   Updating existing stack: ${STACK_NAME}`)
      try {
        await cfn.updateStack({
          stackName: STACK_NAME,
          templateBody: template,
          capabilities: ['CAPABILITY_IAM'],
        })
        console.log('   Waiting for stack update...')
        await cfn.waitForStack(STACK_NAME, 'stack-update-complete')
      }
      catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('No updates')) {
          console.log('   Stack is up to date')
        }
        else {
          throw error
        }
      }
    }
    else {
      console.log(`   Creating stack: ${STACK_NAME}`)
      await cfn.createStack({
        stackName: STACK_NAME,
        templateBody: template,
        capabilities: ['CAPABILITY_IAM'],
        tags: [
          { Key: 'Project', Value: 'ts-analytics' },
          { Key: 'ManagedBy', Value: 'ts-cloud' },
        ],
      })
      console.log('   Waiting for stack creation...')
      await cfn.waitForStack(STACK_NAME, 'stack-create-complete')
    }

    // Get outputs
    const outputs = await cfn.getStackOutputs(STACK_NAME)
    const serviceUrl = outputs.ServiceUrl

    console.log('\n✅ Deployment complete!')
    console.log(`   Service URL: https://${serviceUrl}`)

    // Step 4: Create Route53 CNAME for custom domain (optional)
    if (DOMAIN && BASE_DOMAIN) {
      console.log('\n4. Setting up custom domain...')

      // Get hosted zone for base domain
      const hostedZones = await route53.listHostedZones()
      const hostedZone = hostedZones.HostedZones.find(
        (hz: { Name: string }) => hz.Name === `${BASE_DOMAIN}.`,
      )

      if (hostedZone) {
        const hostedZoneId = hostedZone.Id.replace('/hostedzone/', '')

        await route53.createRecord({
          HostedZoneId: hostedZoneId,
          Name: DOMAIN,
          Type: 'CNAME',
          TTL: 300,
          Value: serviceUrl,
        })

        console.log(`   Created CNAME: ${DOMAIN} -> ${serviceUrl}`)
        console.log(`\n   Custom domain: https://${DOMAIN}`)
      }
      else {
        console.log(`   Warning: Hosted zone for ${BASE_DOMAIN} not found`)
        console.log(`   Please manually create a CNAME: ${DOMAIN} -> ${serviceUrl}`)
      }
    }

    console.log('\n🎉 Analytics API deployed successfully!')
    console.log(`\nUpdate your bunpress.config.ts apiEndpoint to:`)
    console.log(`   https://${serviceUrl}/collect`)
    if (DOMAIN) {
      console.log(`   or: https://${DOMAIN}/collect`)
    }
  }
  catch (error) {
    console.error('Deployment failed:', error)
    process.exit(1)
  }
}

// Run deployment
deployAPI()
