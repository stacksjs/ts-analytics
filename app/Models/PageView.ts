import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'PageView',
  table: 'page_views',
  primaryKey: 'id',

  traits: {
    useTimestamps: true,
  },

  belongsTo: ['Site', 'Session'],

  indexes: [
    { name: 'pv_site_timestamp', columns: ['site_id', 'timestamp'] },
    { name: 'pv_session', columns: ['session_id'] },
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

    path: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    hostname: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    title: {
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

    utm_content: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    utm_term: {
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

    browser_version: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    os: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    os_version: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    screen_width: {
      fillable: true,
      validation: { rule: schema.number().optional() },
    },

    screen_height: {
      fillable: true,
      validation: { rule: schema.number().optional() },
    },

    is_unique: {
      fillable: true,
      validation: { rule: schema.boolean().optional() },
      factory: () => false,
    },

    is_bounce: {
      fillable: true,
      validation: { rule: schema.boolean().optional() },
      factory: () => false,
    },

    time_on_page: {
      fillable: true,
      validation: { rule: schema.number().optional() },
    },

    timestamp: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },
  },
})
