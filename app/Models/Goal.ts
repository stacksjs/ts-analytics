import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Goal',
  table: 'goals',
  primaryKey: 'id',

  traits: {
    useTimestamps: true,
  },

  belongsTo: ['Site'],
  hasMany: ['GoalStats', 'Conversion'],

  indexes: [
    { name: 'goals_site', columns: ['site_id'] },
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

    name: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    type: {
      fillable: true,
      validation: { rule: schema.string().required() },
    },

    pattern: {
      fillable: true,
      validation: { rule: schema.string().optional() },
    },

    match_type: {
      fillable: true,
      validation: { rule: schema.string().optional() },
      factory: () => 'exact',
    },

    duration_minutes: {
      fillable: true,
      validation: { rule: schema.number().optional() },
    },

    value: {
      fillable: true,
      validation: { rule: schema.number().optional() },
    },

    is_active: {
      fillable: true,
      validation: { rule: schema.boolean().optional() },
      factory: () => true,
    },
  },
})
