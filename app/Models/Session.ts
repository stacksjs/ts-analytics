import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Session',
  table: 'sessions',
  primaryKey: 'id',

  traits: {
    useTimestamps: true,
  },

  belongsTo: ['Site'],
  hasMany: ['PageView', 'CustomEvent'],

  indexes: [
    { name: 'sessions_site_started', columns: ['site_id', 'started_at'] },
    { name: 'sessions_visitor', columns: ['visitor_id'] },
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

    visitor_id: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    entry_path: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    exit_path: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    referrer: {
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

    utm_medium: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    utm_campaign: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    country: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    region: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    city: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    device_type: {
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

    page_view_count: {
      fillable: true,
      validation: { rule: schema.number().optional() },
      factory: () => 0,
    },

    event_count: {
      fillable: true,
      validation: { rule: schema.number().optional() },
      factory: () => 0,
    },

    is_bounce: {
      fillable: true,
      validation: { rule: schema.boolean().optional() },
      factory: () => true,
    },

    duration: {
      fillable: true,
      validation: { rule: schema.number().optional() },
      factory: () => 0,
    },

    started_at: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    ended_at: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },
  },
})
