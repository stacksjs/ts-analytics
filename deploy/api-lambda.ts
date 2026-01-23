/**
 * Deploy Analytics API to AWS Lambda
 *
 * Uses ts-cloud CloudFormation to deploy:
 * - Lambda function with API handler
 * - API Gateway HTTP API
 * - Route53 DNS (optional)
 */

import { CloudFormationClient } from '../../ts-cloud/packages/ts-cloud/src/aws/cloudformation'
import { S3Client } from '../../ts-cloud/packages/ts-cloud/src/aws/s3'
import { Route53Client } from '../../ts-cloud/packages/ts-cloud/src/aws/route53'

const SERVICE_NAME = process.env.API_SERVICE_NAME || 'ts-analytics-api'
const STACK_NAME = `${SERVICE_NAME}-lambda-stack`
const REGION = process.env.AWS_REGION || 'us-east-1'
const DOMAIN = process.env.API_DOMAIN || 'analytics-api.stacksjs.com'
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'stacksjs.com'
const TABLE_NAME = process.env.ANALYTICS_TABLE_NAME || 'ts-analytics'
const BUCKET_NAME = `${SERVICE_NAME}-deployment-${REGION}`

async function deployLambdaAPI() {
  console.log('Deploying Analytics API to AWS Lambda')
  console.log(`Service: ${SERVICE_NAME}`)
  console.log(`Domain: ${DOMAIN}`)
  console.log(`Region: ${REGION}`)
  console.log(`DynamoDB Table: ${TABLE_NAME}`)

  const cfn = new CloudFormationClient(REGION)
  const s3 = new S3Client(REGION)
  const route53 = new Route53Client(REGION)

  // Step 1: Create S3 bucket for deployment artifacts
  console.log('\n1. Setting up deployment bucket...')
  let bucketCreated = false
  try {
    const bucketExists = await s3.headBucket(BUCKET_NAME)
    if (!bucketExists.exists) {
      await s3.createBucket(BUCKET_NAME)
      bucketCreated = true
      console.log(`   Created S3 bucket: ${BUCKET_NAME}`)
      // Wait for bucket to be available (S3 eventual consistency)
      console.log('   Waiting for bucket to be available...')
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    else {
      console.log(`   Using existing bucket: ${BUCKET_NAME}`)
    }
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('already owned') || message.includes('BucketAlreadyOwnedByYou')) {
      console.log(`   Bucket already exists: ${BUCKET_NAME}`)
    }
    else {
      throw error
    }
  }

  // Step 2: Bundle and upload Lambda code
  console.log('\n2. Bundling Lambda function...')

  // Use Bun to bundle the Lambda handler as CommonJS for Lambda compatibility
  const bundleResult = await Bun.build({
    entrypoints: ['./deploy/lambda-handler.ts'],
    outdir: './dist/lambda',
    target: 'node',
    format: 'cjs', // CommonJS for Lambda Node.js runtime
    minify: true,
    sourcemap: 'none',
    external: [], // Bundle everything
  })

  if (!bundleResult.success) {
    console.error('Bundle errors:', bundleResult.logs)
    throw new Error('Failed to bundle Lambda function')
  }

  console.log('   Bundled successfully')

  // Create zip file
  const zipPath = './dist/lambda/function.zip'
  const jsPath = './dist/lambda/lambda-handler.js'

  // Read the bundled JS and create a simple zip
  const jsContent = await Bun.file(jsPath).text()

  // Create a zip using Bun's built-in capabilities
  const { Gzip } = await import('bun')

  // For Lambda, we need a proper ZIP file. Let's use a simpler approach
  const proc = Bun.spawn(['zip', '-j', zipPath, jsPath], {
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await proc.exited

  if (proc.exitCode !== 0) {
    throw new Error('Failed to create zip file')
  }

  console.log('   Created deployment package')

  // Upload to S3 using ts-cloud
  const zipBuffer = await Bun.file(zipPath).arrayBuffer()
  const s3Key = `lambda/${SERVICE_NAME}-${Date.now()}.zip`

  console.log('   Uploading to S3...')
  await s3.putObject({
    bucket: BUCKET_NAME,
    key: s3Key,
    body: Buffer.from(zipBuffer),
    contentType: 'application/zip',
  })

  console.log(`   Uploaded to s3://${BUCKET_NAME}/${s3Key}`)

  // Step 3: Deploy CloudFormation stack
  console.log('\n3. Deploying Lambda and API Gateway...')

  const template = JSON.stringify({
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'ts-analytics API Lambda',

    Parameters: {
      S3Bucket: { Type: 'String', Default: BUCKET_NAME },
      S3Key: { Type: 'String', Default: s3Key },
      TableName: { Type: 'String', Default: TABLE_NAME },
    },

    Resources: {
      // Lambda execution role
      LambdaRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'lambda.amazonaws.com' },
                Action: 'sts:AssumeRole',
              },
            ],
          },
          ManagedPolicyArns: [
            'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
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

      // Lambda function
      LambdaFunction: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          FunctionName: SERVICE_NAME,
          Runtime: 'nodejs20.x',
          Handler: 'lambda-handler.handler',
          Code: {
            S3Bucket: { Ref: 'S3Bucket' },
            S3Key: { Ref: 'S3Key' },
          },
          Role: { 'Fn::GetAtt': ['LambdaRole', 'Arn'] },
          MemorySize: 256,
          Timeout: 30,
          Environment: {
            Variables: {
              ANALYTICS_TABLE_NAME: { Ref: 'TableName' },
              AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
            },
          },
        },
      },

      // HTTP API (API Gateway v2)
      HttpApi: {
        Type: 'AWS::ApiGatewayV2::Api',
        Properties: {
          Name: `${SERVICE_NAME}-api`,
          ProtocolType: 'HTTP',
          CorsConfiguration: {
            AllowOrigins: ['*'],
            AllowMethods: ['GET', 'POST', 'OPTIONS'],
            AllowHeaders: ['Content-Type'],
            MaxAge: 86400,
          },
        },
      },

      // Lambda integration
      LambdaIntegration: {
        Type: 'AWS::ApiGatewayV2::Integration',
        Properties: {
          ApiId: { Ref: 'HttpApi' },
          IntegrationType: 'AWS_PROXY',
          IntegrationUri: { 'Fn::GetAtt': ['LambdaFunction', 'Arn'] },
          PayloadFormatVersion: '2.0',
        },
      },

      // Default route
      DefaultRoute: {
        Type: 'AWS::ApiGatewayV2::Route',
        Properties: {
          ApiId: { Ref: 'HttpApi' },
          RouteKey: '$default',
          Target: { 'Fn::Join': ['/', ['integrations', { Ref: 'LambdaIntegration' }]] },
        },
      },

      // API Stage
      ApiStage: {
        Type: 'AWS::ApiGatewayV2::Stage',
        Properties: {
          ApiId: { Ref: 'HttpApi' },
          StageName: '$default',
          AutoDeploy: true,
        },
      },

      // Lambda permission for API Gateway
      LambdaPermission: {
        Type: 'AWS::Lambda::Permission',
        Properties: {
          FunctionName: { Ref: 'LambdaFunction' },
          Action: 'lambda:InvokeFunction',
          Principal: 'apigateway.amazonaws.com',
          SourceArn: { 'Fn::Sub': 'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${HttpApi}/*' },
        },
      },
    },

    Outputs: {
      ApiEndpoint: {
        Description: 'API Gateway endpoint URL',
        Value: { 'Fn::GetAtt': ['HttpApi', 'ApiEndpoint'] },
      },
      LambdaArn: {
        Description: 'Lambda function ARN',
        Value: { 'Fn::GetAtt': ['LambdaFunction', 'Arn'] },
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
    const apiEndpoint = outputs.ApiEndpoint

    console.log('\n✅ Deployment complete!')
    console.log(`   API Endpoint: ${apiEndpoint}`)

    // Test the health endpoint
    console.log('\n4. Testing API...')
    try {
      const healthResponse = await fetch(`${apiEndpoint}/health`)
      const healthData = await healthResponse.json()
      console.log(`   Health check: ${JSON.stringify(healthData)}`)
    }
    catch (error) {
      console.log('   Health check failed (Lambda may still be initializing)')
    }

    // Step 4: Create Route53 CNAME for custom domain (optional)
    if (DOMAIN && BASE_DOMAIN) {
      console.log('\n5. Setting up custom domain...')

      // Extract the hostname from the API endpoint
      const apiHostname = apiEndpoint.replace('https://', '').replace(/\/$/, '')

      // Get hosted zone for base domain
      const hostedZones = await route53.listHostedZones()
      const hostedZone = hostedZones.HostedZones.find(
        (hz: { Name: string }) => hz.Name === `${BASE_DOMAIN}.`,
      )

      if (hostedZone) {
        const hostedZoneId = hostedZone.Id.replace('/hostedzone/', '')

        try {
          await route53.createCnameRecord({
            hostedZoneId: hostedZoneId,
            name: DOMAIN,
            value: apiHostname,
            ttl: 300,
          })
          console.log(`   Created CNAME: ${DOMAIN} -> ${apiHostname}`)
        }
        catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes('already exists') || message.includes('it already exists')) {
            console.log(`   CNAME already exists: ${DOMAIN}`)
          }
          else {
            console.log(`   Warning: Could not create CNAME: ${message}`)
          }
        }
      }
      else {
        console.log(`   Warning: Hosted zone for ${BASE_DOMAIN} not found`)
        console.log(`   Please manually create a CNAME: ${DOMAIN} -> ${apiHostname}`)
      }
    }

    console.log('\n🎉 Analytics API deployed successfully!')
    console.log(`\nCollect endpoint: ${apiEndpoint}/collect`)
    console.log(`Script endpoint: ${apiEndpoint}/sites/{siteId}/script`)
    console.log(`\nUpdate your bunpress.config.ts apiEndpoint to:`)
    console.log(`   ${apiEndpoint}/collect`)
  }
  catch (error) {
    console.error('Deployment failed:', error)
    process.exit(1)
  }
}

// Run deployment
deployLambdaAPI()
