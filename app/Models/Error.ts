import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Error',
  table: 'errors',
  primaryKey: 'id',

  traits: {
    useTimestamps: true,
  },

  belongsTo: ['Site'],

  indexes: [
    { name: 'errors_site_timestamp', columns: ['site_id', 'timestamp'] },
    { name: 'errors_site_fingerprint', columns: ['site_id', 'fingerprint'] },
  ],

  attributes: {
    id: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    site_id: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    message: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    stack: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    error_type: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    category: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    severity: {
      fillable: true,
      validation: { rule: schema.string().optional() },
      factory: () => 'error',
    },

    fingerprint: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    url: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    browser: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    os: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    user_agent: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    framework: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    status: {
      fillable: true,
      validation: { rule: schema.string().optional() },
      factory: () => 'open',
    },

    api_key_id: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    metadata: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    timestamp: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },
  },
})
