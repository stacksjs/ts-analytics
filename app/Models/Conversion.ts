import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Conversion',
  table: 'conversions',
  primaryKey: 'id',

  traits: {
    useTimestamps: true,
  },

  belongsTo: ['Site', 'Goal'],

  indexes: [
    { name: 'conv_site_goal_timestamp', columns: ['site_id', 'goal_id', 'timestamp'] },
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

    goal_id: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    visitor_id: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    session_id: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    value: {
      fillable: true,
      validation: { rule: schema.number().optional() },
    },

    path: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    referrer_source: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    utm_source: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    utm_campaign: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    timestamp: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },
  },
})
