/** @type {import("@xlameiro/env-typegen").EnvContract} */
const contract = {
  schemaVersion: 1,
  variables: {
    DATABASE_URL: {
      expected: { type: "url" },
      required: true,
      clientSide: false,
    },
    DATABASE_READONLY_URL: {
      expected: { type: "url" },
      required: false,
      clientSide: false,
    },
    DATABASE_POOL_SIZE: {
      expected: { type: "number" },
      required: false,
      clientSide: false,
    },
    PORT: { expected: { type: "number" }, required: true, clientSide: false },
    NODE_ENV: {
      expected: { type: "string" },
      required: true,
      clientSide: false,
    },
    DEBUG: {
      expected: { type: "boolean" },
      required: false,
      clientSide: false,
    },
    LOG_LEVEL: {
      expected: { type: "string" },
      required: false,
      clientSide: false,
    },
    AUTH_SECRET: {
      expected: { type: "string" },
      required: true,
      clientSide: false,
    },
    AUTH_TOKEN_EXPIRY: {
      expected: { type: "number" },
      required: false,
      clientSide: false,
    },
    STRIPE_SECRET_KEY: {
      expected: { type: "string" },
      required: true,
      clientSide: false,
    },
    STRIPE_WEBHOOK_SECRET: {
      expected: { type: "string" },
      required: false,
      clientSide: false,
    },
    NEXT_PUBLIC_APP_URL: {
      expected: { type: "url" },
      required: true,
      clientSide: true,
    },
    NEXT_PUBLIC_API_URL: {
      expected: { type: "url" },
      required: true,
      clientSide: true,
    },
    NEXT_PUBLIC_ANALYTICS_ID: {
      expected: { type: "string" },
      required: false,
      clientSide: true,
    },
    NEXT_PUBLIC_FEATURE_FLAGS: {
      expected: { type: "string" },
      required: false,
      clientSide: true,
    },
    ENABLE_ANALYTICS: {
      expected: { type: "boolean" },
      required: false,
      clientSide: false,
    },
    ENABLE_MAINTENANCE_MODE: {
      expected: { type: "boolean" },
      required: false,
      clientSide: false,
    },
    ENABLE_BETA_FEATURES: {
      expected: { type: "boolean" },
      required: false,
      clientSide: false,
    },
    APP_VERSION: {
      expected: { type: "string" },
      required: false,
      clientSide: false,
    },
    ALLOWED_ORIGINS: {
      expected: { type: "string" },
      required: false,
      clientSide: false,
    },
    MAX_UPLOAD_SIZE: {
      expected: { type: "number" },
      required: false,
      clientSide: false,
    },
  },
};

export default contract;
