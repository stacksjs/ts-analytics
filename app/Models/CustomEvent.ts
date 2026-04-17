import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'CustomEvent',
  table: 'custom_events',
  primaryKey: 'id',

  traits: {
    useTimestamps: true,
  },

  belongsTo: ['Site', 'Session'],

  indexes: [
    { name: 'ce_site_timestamp', columns: ['site_id', 'timestamp'] },
    { name: 'ce_session', columns: ['session_id'] },
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

    session_id: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    visitor_id: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    name: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    category: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    value: {
      fillable: true,
      validation: { rule: schema.number().optional() },
    },

    properties: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    path: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    timestamp: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },
  },
})
