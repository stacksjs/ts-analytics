import type { Model } from './types'

/**
 * Conversion record (goal completion)
 *
 * DynamoDB Keys:
 * - PK: SITE#{siteId}
 * - SK: CONVERSION#{timestamp}#{conversionId}
 * - GSI1PK: SITE#{siteId}#GOAL#{goalId}
 * - GSI1SK: CONVERSION#{timestamp}
 */
const ConversionModel: Model = {
  name: 'Conversion',
  table: 'analytics', // Single-table design
  primaryKey: 'id',
  autoIncrement: false,

  traits: {
    useUuid: true,
    useTtl: true,
  },

  belongsTo: ['Site', 'Goal', 'Session'],

  attributes: {
    id: {
      required: true,
      unique: true,
      validation: {
        rule: 'string',
      },
    },

    siteId: {
      required: true,
      fillable: true,
      validation: {
        rule: 'string',
      },
    },

    goalId: {
      required: true,
      fillable: true,
      validation: {
        rule: 'string',
      },
    },

    visitorId: {
      required: true,
      fillable: true,
      validation: {
        rule: 'string',
      },
    },

    sessionId: {
      required: true,
      fillable: true,
      validation: {
        rule: 'string',
      },
    },

    value: {
      fillable: true,
      validation: {
        rule: 'number',
      },
      cast: 'number',
      comment: 'Conversion value (from goal or event)',
    },

    path: {
      required: true,
      fillable: true,
      validation: {
        rule: 'string',
      },
      comment: 'Page path where conversion occurred',
    },

    referrerSource: {
      fillable: true,
      validation: {
        rule: 'string',
      },
    },

    utmSource: {
      fillable: true,
      validation: {
        rule: 'string',
      },
    },

    utmCampaign: {
      fillable: true,
      validation: {
        rule: 'string',
      },
    },

    timestamp: {
      required: true,
      fillable: true,
      validation: {
        rule: 'date',
      },
      cast: 'datetime',
    },

    ttl: {
      fillable: true,
      validation: {
        rule: 'number',
      },
      cast: 'number',
    },
  },

  // DynamoDB single-table key patterns
  dynamodb: {
    pk: (conv: { siteId: string }): string => `SITE#${conv.siteId}`,
    sk: (conv: { timestamp: Date, id: string }): string =>
      `CONVERSION#${conv.timestamp.toISOString()}#${conv.id}`,
    gsi1pk: (conv: { siteId: string, goalId: string }): string =>
      `SITE#${conv.siteId}#GOAL#${conv.goalId}`,
    gsi1sk: (conv: { timestamp: Date }): string =>
      `CONVERSION#${conv.timestamp.toISOString()}`,
  },
}

export default ConversionModel
