import type { Attributes } from '@stacksjs/types'
import { defineModel } from '@stacksjs/orm'
import { makeHash } from '@stacksjs/security'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'User',
  table: 'users',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useAuth: true,
    useTimestamps: true,
  },

  hasMany: ['Site'],

  attributes: {
    email: {
      unique: true,
      fillable: true,
      validation: {
        rule: schema.string().email().required(),
      },
    },

    password: {
      hidden: true,
      fillable: true,
      validation: {
        rule: schema.string().required().min(6).max(255),
      },
    },

    name: {
      fillable: true,
      validation: {
        rule: schema.string().optional().max(255),
      },
    },

    role: {
      fillable: true,
      validation: {
        rule: schema.string().optional(),
      },
      factory: () => 'viewer',
    },
  },

  set: {
    password: async (attributes: Attributes) => {
      return await makeHash(attributes.password, { algorithm: 'bcrypt' })
    },
  },
})
