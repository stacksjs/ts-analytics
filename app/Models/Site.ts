import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Site',
  table: 'sites',
  primaryKey: 'id',

  traits: {
    useTimestamps: true,
  },

  belongsTo: ['User'],
  hasMany: ['Session', 'PageView', 'CustomEvent', 'Goal', 'Error'],

  attributes: {
    id: {
      fillable: true,
      validation: {
        rule: schema.string().required(),
      },
    },

    name: {
      fillable: true,
      validation: {
        rule: schema.string().required().max(255),
      },
    },

    domains: {
      fillable: true,
      validation: {
        rule: schema.string().optional(),
      },
      factory: () => '[]',
    },

    timezone: {
      fillable: true,
      validation: {
        rule: schema.string().optional(),
      },
      factory: () => 'UTC',
    },

    is_active: {
      fillable: true,
      validation: {
        rule: schema.boolean().optional(),
      },
      factory: () => true,
    },

    owner_id: {
      fillable: true,
      validation: {
        rule: schema.number().optional(),
      },
    },

    settings: {
      fillable: true,
      validation: {
        rule: schema.string().optional(),
      },
      factory: () => '{}',
    },
  },
})
