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
import { ACMClient, ACMDnsValidator } from '../../ts-cloud/packages/ts-cloud/src/aws/acm'

const SERVICE_NAME = process.env.API_SERVICE_NAME || 'ts-analytics-api'
const STACK_NAME = `${SERVICE_NAME}-lambda-stack`
const REGION = process.env.AWS_REGION || 'us-east-1'
const DOMAIN = process.env.API_DOMAIN || 'analytics.stacksjs.com'
const STEALTH_DOMAIN = process.env.API_STEALTH_DOMAIN || 'a.stacksjs.com' // Less likely to be blocked
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
  const acm = new ACMClient('us-east-1') // ACM certs must be in us-east-1 for API Gateway
  const acmValidator = new ACMDnsValidator('us-east-1')

  // Step 0: Get or create SSL certificates for custom domains
  console.log('\n0. Setting up SSL certificates...')
  let certificateArn: string | undefined
  let stealthCertificateArn: string | undefined

  // Helper function to get or create certificate
  async function getOrCreateCertificate(domain: string): Promise<string | undefined> {
    try {
      const existingCert = await acm.findCertificateByDomain(domain)
      if (existingCert && existingCert.Status === 'ISSUED') {
        console.log(`   Using existing certificate for ${domain}: ${existingCert.CertificateArn}`)
        return existingCert.CertificateArn
      }

      const hostedZone = await route53.findHostedZoneForDomain(domain)
      if (hostedZone) {
        const hostedZoneId = hostedZone.Id.replace('/hostedzone/', '')
        console.log(`   Requesting certificate for ${domain}...`)
        const certResult = await acmValidator.requestAndValidate({
          domainName: domain,
          hostedZoneId,
          waitForValidation: true,
          maxWaitMinutes: 10,
        })
        console.log(`   Certificate issued for ${domain}: ${certResult.certificateArn}`)
        return certResult.certificateArn
      } else {
        console.log(`   Warning: No hosted zone found for ${domain}`)
      }
    } catch (error) {
      console.log(`   Warning: Could not setup certificate for ${domain}: ${error}`)
    }
    return undefined
  }

  // Get certificate for main domain
  if (DOMAIN && BASE_DOMAIN) {
    certificateArn = await getOrCreateCertificate(DOMAIN)
  }

  // Get certificate for stealth domain (if different from main domain)
  if (STEALTH_DOMAIN && STEALTH_DOMAIN !== DOMAIN) {
    stealthCertificateArn = await getOrCreateCertificate(STEALTH_DOMAIN)
  }

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
    external: ['bunfig'], // bunfig not needed at runtime, causes bundling issues
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
      CertificateArn: { Type: 'String', Default: certificateArn || '' },
      CustomDomain: { Type: 'String', Default: DOMAIN || '' },
      StealthCertificateArn: { Type: 'String', Default: stealthCertificateArn || '' },
      StealthDomain: { Type: 'String', Default: STEALTH_DOMAIN || '' },
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
              STEALTH_DOMAIN: STEALTH_DOMAIN,
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

      // Custom Domain (conditional on certificate being available)
      ...(certificateArn ? {
        ApiDomainName: {
          Type: 'AWS::ApiGatewayV2::DomainName',
          Properties: {
            DomainName: { Ref: 'CustomDomain' },
            DomainNameConfigurations: [
              {
                CertificateArn: { Ref: 'CertificateArn' },
                EndpointType: 'REGIONAL',
              },
            ],
          },
        },
        ApiMapping: {
          Type: 'AWS::ApiGatewayV2::ApiMapping',
          DependsOn: ['ApiDomainName', 'ApiStage'],
          Properties: {
            ApiId: { Ref: 'HttpApi' },
            DomainName: { Ref: 'CustomDomain' },
            Stage: '$default',
          },
        },
      } : {}),

      // Stealth Domain (less likely to be blocked by ad blockers)
      ...(stealthCertificateArn && STEALTH_DOMAIN !== DOMAIN ? {
        StealthDomainName: {
          Type: 'AWS::ApiGatewayV2::DomainName',
          Properties: {
            DomainName: { Ref: 'StealthDomain' },
            DomainNameConfigurations: [
              {
                CertificateArn: { Ref: 'StealthCertificateArn' },
                EndpointType: 'REGIONAL',
              },
            ],
          },
        },
        StealthApiMapping: {
          Type: 'AWS::ApiGatewayV2::ApiMapping',
          DependsOn: ['StealthDomainName', 'ApiStage'],
          Properties: {
            ApiId: { Ref: 'HttpApi' },
            DomainName: { Ref: 'StealthDomain' },
            Stage: '$default',
          },
        },
      } : {}),
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
      ...(certificateArn ? {
        CustomDomainTarget: {
          Description: 'Custom domain target for Route53',
          Value: { 'Fn::GetAtt': ['ApiDomainName', 'RegionalDomainName'] },
        },
        CustomDomainHostedZoneId: {
          Description: 'Custom domain hosted zone ID',
          Value: { 'Fn::GetAtt': ['ApiDomainName', 'RegionalHostedZoneId'] },
        },
      } : {}),
      ...(stealthCertificateArn && STEALTH_DOMAIN !== DOMAIN ? {
        StealthDomainTarget: {
          Description: 'Stealth domain target for Route53',
          Value: { 'Fn::GetAtt': ['StealthDomainName', 'RegionalDomainName'] },
        },
        StealthDomainHostedZoneId: {
          Description: 'Stealth domain hosted zone ID',
          Value: { 'Fn::GetAtt': ['StealthDomainName', 'RegionalHostedZoneId'] },
        },
      } : {}),
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

    // Step 4: Create Route53 A record for custom domain
    if (DOMAIN && BASE_DOMAIN && certificateArn) {
      console.log('\n5. Setting up custom domain DNS...')

      const customDomainTarget = outputs.CustomDomainTarget
      const customDomainHostedZoneId = outputs.CustomDomainHostedZoneId

      if (customDomainTarget && customDomainHostedZoneId) {
        // Get hosted zone for base domain
        const hostedZone = await route53.findHostedZoneForDomain(DOMAIN)

        if (hostedZone) {
          const hostedZoneId = hostedZone.Id.replace('/hostedzone/', '')

          try {
            // Create A record alias pointing to API Gateway custom domain
            await route53.createAliasRecord({
              HostedZoneId: hostedZoneId,
              Name: DOMAIN,
              Type: 'A',
              TargetHostedZoneId: customDomainHostedZoneId,
              TargetDNSName: customDomainTarget,
              EvaluateTargetHealth: false,
            })
            console.log(`   Created A record: ${DOMAIN} -> ${customDomainTarget}`)
          }
          catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('already exists') || message.includes('it already exists')) {
              console.log(`   A record already exists: ${DOMAIN}`)
            }
            else {
              console.log(`   Warning: Could not create A record: ${message}`)
            }
          }
        }
        else {
          console.log(`   Warning: Hosted zone for ${BASE_DOMAIN} not found`)
        }

        // Also set up stealth domain if different from main domain and has its own certificate
        if (STEALTH_DOMAIN && STEALTH_DOMAIN !== DOMAIN && stealthCertificateArn) {
          const stealthDomainTarget = outputs.StealthDomainTarget
          const stealthDomainHostedZoneId = outputs.StealthDomainHostedZoneId

          if (stealthDomainTarget && stealthDomainHostedZoneId) {
            const stealthHostedZone = await route53.findHostedZoneForDomain(STEALTH_DOMAIN)
            if (stealthHostedZone) {
              const stealthHostedZoneId = stealthHostedZone.Id.replace('/hostedzone/', '')
              try {
                await route53.createAliasRecord({
                  HostedZoneId: stealthHostedZoneId,
                  Name: STEALTH_DOMAIN,
                  Type: 'A',
                  TargetHostedZoneId: stealthDomainHostedZoneId,
                  TargetDNSName: stealthDomainTarget,
                  EvaluateTargetHealth: false,
                })
                console.log(`   Created A record: ${STEALTH_DOMAIN} -> ${stealthDomainTarget}`)
              }
              catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error)
                if (message.includes('already exists') || message.includes('it already exists')) {
                  console.log(`   A record already exists: ${STEALTH_DOMAIN}`)
                }
                else {
                  console.log(`   Warning: Could not create stealth A record: ${message}`)
                }
              }
            }
          }
        }
      }
      else {
        console.log('   Warning: Custom domain outputs not available')
      }
    }

    const dashboardUrl = certificateArn ? `https://${DOMAIN}/dashboard` : `${apiEndpoint}/dashboard`
    const collectUrl = certificateArn ? `https://${DOMAIN}/collect` : `${apiEndpoint}/collect`
    const stealthCollectUrl = stealthCertificateArn ? `https://${STEALTH_DOMAIN}/t` : null

    console.log('\n🎉 Analytics API deployed successfully!')
    console.log(`\nDashboard: ${dashboardUrl}?siteId=YOUR_SITE_ID`)
    console.log(`Collect endpoint: ${collectUrl}`)
    console.log(`Script endpoint: ${apiEndpoint}/sites/{siteId}/script`)
    if (certificateArn) {
      console.log(`\nCustom domain: https://${DOMAIN}`)
    }
    if (stealthCollectUrl) {
      console.log(`\nStealth domain (ad-blocker resistant):`)
      console.log(`   Collect: ${stealthCollectUrl}`)
      console.log(`   Script: https://${STEALTH_DOMAIN}/sites/{siteId}/script?stealth=true`)
    }
    console.log(`\nUpdate your bunpress.config.ts apiEndpoint to:`)
    console.log(`   ${stealthCollectUrl || collectUrl}`)
  }
  catch (error) {
    console.error('Deployment failed:', error)
    process.exit(1)
  }
}

// Run deployment
deployLambdaAPI()
