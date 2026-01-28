#!/usr/bin/env bun
/**
 * Publish Bun Lambda layer using ts-cloud
 */

import { LambdaClient } from '../../ts-cloud/packages/ts-cloud/src/aws/lambda'
import { S3Client } from '../../ts-cloud/packages/ts-cloud/src/aws/s3'
import fs from 'node:fs'
import path from 'node:path'

const LAYER_NAME = 'bun-runtime'
const REGION = process.env.AWS_REGION || 'us-east-1'
const LAYER_ZIP_PATH = '/tmp/bun-lambda-setup/bun/packages/bun-lambda/bun-lambda-layer.zip'
const S3_BUCKET = process.env.API_SERVICE_NAME ? `${process.env.API_SERVICE_NAME}-deployment-${REGION}` : `ts-analytics-api-deployment-${REGION}`

async function publishBunLayer() {
  console.log('Publishing Bun Lambda layer...')
  console.log(`  Layer name: ${LAYER_NAME}`)
  console.log(`  Region: ${REGION}`)

  // Check if layer zip exists
  if (!fs.existsSync(LAYER_ZIP_PATH)) {
    console.error(`Layer zip not found at ${LAYER_ZIP_PATH}`)
    console.log('Building layer first...')

    // Build the layer
    const buildProc = Bun.spawn(['bun', 'run', 'build-layer', '--', '--arch', 'aarch64', '--release', 'latest'], {
      cwd: '/tmp/bun-lambda-setup/bun/packages/bun-lambda',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await buildProc.exited

    if (buildProc.exitCode !== 0) {
      throw new Error('Failed to build layer')
    }
  }

  const lambda = new LambdaClient(REGION)
  const s3 = new S3Client(REGION)

  // Read the layer zip
  const layerZip = await Bun.file(LAYER_ZIP_PATH).arrayBuffer()
  const layerZipBuffer = Buffer.from(layerZip)

  console.log(`  Layer zip size: ${(layerZipBuffer.length / 1024 / 1024).toFixed(2)} MB`)

  // For large files, upload to S3 first (Lambda API has a 50MB limit for direct upload)
  if (layerZipBuffer.length > 50 * 1024 * 1024) {
    console.log('  Layer too large for direct upload, using S3...')
    const s3Key = `layers/${LAYER_NAME}-${Date.now()}.zip`

    await s3.putObject({
      bucket: S3_BUCKET,
      key: s3Key,
      body: layerZipBuffer,
      contentType: 'application/zip',
    })
    console.log(`  Uploaded to s3://${S3_BUCKET}/${s3Key}`)

    // Publish layer from S3
    const result = await lambda.publishLayerVersion({
      LayerName: LAYER_NAME,
      Description: 'Bun runtime for AWS Lambda (aarch64)',
      Content: {
        S3Bucket: S3_BUCKET,
        S3Key: s3Key,
      },
      CompatibleRuntimes: ['provided.al2', 'provided.al2023'],
      CompatibleArchitectures: ['arm64'],
    })

    console.log(`\n✅ Layer published successfully!`)
    console.log(`  Layer ARN: ${result.LayerVersionArn}`)
    console.log(`  Version: ${result.Version}`)

    return result
  } else {
    // Direct upload
    const result = await lambda.publishLayerVersion({
      LayerName: LAYER_NAME,
      Description: 'Bun runtime for AWS Lambda (aarch64)',
      Content: {
        ZipFile: layerZipBuffer.toString('base64'),
      },
      CompatibleRuntimes: ['provided.al2', 'provided.al2023'],
      CompatibleArchitectures: ['arm64'],
    })

    console.log(`\n✅ Layer published successfully!`)
    console.log(`  Layer ARN: ${result.LayerVersionArn}`)
    console.log(`  Version: ${result.Version}`)

    return result
  }
}

// Run
publishBunLayer()
  .then(result => {
    // Output the ARN for use in deployment
    console.log(`\nUse this layer ARN in your Lambda function:`)
    console.log(`  ${result.LayerVersionArn}`)
  })
  .catch(err => {
    console.error('Failed to publish layer:', err)
    process.exit(1)
  })
