// Stub AWS credentials for tests that import modules with eager DynamoDB client initialization
process.env.AWS_ACCESS_KEY_ID ??= 'test'
process.env.AWS_SECRET_ACCESS_KEY ??= 'test'
