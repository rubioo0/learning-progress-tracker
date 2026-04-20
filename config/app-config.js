function parseBoolean(value, defaultValue) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseNumber(value, defaultValue) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseList(value, defaultValue = []) {
    if (!value || typeof value !== 'string') {
        return defaultValue;
    }

    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const cloudinaryConfigured = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME
    && process.env.CLOUDINARY_API_KEY
    && process.env.CLOUDINARY_API_SECRET
);

module.exports = {
    // Server configuration
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: process.env.PORT || 3000,

    // CORS configuration
    CORS_ALLOWED_ORIGINS: parseList(process.env.CORS_ALLOWED_ORIGINS, []),
    ALLOW_NULL_ORIGIN: parseBoolean(process.env.ALLOW_NULL_ORIGIN, true),

    // Runtime guards
    REQUIRE_PROD_EXTERNAL_SERVICES: parseBoolean(process.env.REQUIRE_PROD_EXTERNAL_SERVICES, false),

    // AI model configuration
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    AI_FILE_PERSISTENCE: parseBoolean(process.env.AI_FILE_PERSISTENCE, !isProduction),
    AI_MODELS: [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'free', recommended: true },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', tier: 'free' },
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tier: 'free' }
    ],
    AI_DEFAULT_MODEL: process.env.AI_DEFAULT_MODEL || 'gemini-2.5-flash',
    AI_FALLBACK_ORDER: parseList(process.env.AI_FALLBACK_ORDER, ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']),
    AI_RETRY: {
        maxRetriesPerModel: parseNumber(process.env.AI_RETRY_MAX_RETRIES_PER_MODEL, 3),
        baseDelayMs: parseNumber(process.env.AI_RETRY_BASE_DELAY_MS, 3000),
        maxDelayMs: parseNumber(process.env.AI_RETRY_MAX_DELAY_MS, 15000),
        jitterMs: parseNumber(process.env.AI_RETRY_JITTER_MS, 700)
    },
    AI_EXPLAIN_RATE_LIMIT: {
        windowMs: parseNumber(process.env.AI_EXPLAIN_WINDOW_MS, 60000),
        maxRequests: parseNumber(process.env.AI_EXPLAIN_MAX_REQUESTS, 10),
        cooldownMs: parseNumber(process.env.AI_EXPLAIN_COOLDOWN_MS, 15000),
        cacheTtlMs: parseNumber(process.env.AI_EXPLAIN_CACHE_TTL_MS, 10 * 60 * 1000),
        maxTermLength: parseNumber(process.env.AI_EXPLAIN_MAX_TERM_LENGTH, 350)
    },

    // Code validation settings (used in fullscreen edit mode)
    CODE_VALIDATION_ENABLED: parseBoolean(process.env.CODE_VALIDATION_ENABLED, true),
    CODE_VALIDATION: {
        timeoutMs: parseNumber(process.env.CODE_VALIDATION_TIMEOUT_MS, 12000),
        dotnetTimeoutMs: parseNumber(process.env.CODE_VALIDATION_DOTNET_TIMEOUT_MS, 20000),
        maxDiagnostics: parseNumber(process.env.CODE_VALIDATION_MAX_DIAGNOSTICS, 8),
        maxCodeLength: parseNumber(process.env.CODE_VALIDATION_MAX_CODE_LENGTH, 50000)
    },

    // Database configuration
    DATABASE_PROVIDER: process.env.DATABASE_PROVIDER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite'),
    DATABASE_URL: process.env.DATABASE_URL || '',
    DATABASE_PATH: process.env.DATABASE_PATH || './learning_progress.db',
    FORCE_SQLITE: parseBoolean(process.env.FORCE_SQLITE, false),
    ALLOW_SQLITE_FALLBACK: parseBoolean(process.env.ALLOW_SQLITE_FALLBACK, true),

    // File upload/storage configuration
    STORAGE_BACKEND: process.env.STORAGE_BACKEND || (cloudinaryConfigured ? 'cloudinary' : 'local'),
    UPLOAD_DIRECTORY: process.env.UPLOAD_DIRECTORY || 'uploads/',
    MAX_PREVIEW_FILE_SIZE: parseNumber(process.env.MAX_PREVIEW_FILE_SIZE, 200 * 1024),
    CLOUDINARY: {
        CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
        API_KEY: process.env.CLOUDINARY_API_KEY || '',
        API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
        FOLDER: process.env.CLOUDINARY_FOLDER || 'qa-road-attachments',
        RESOURCE_TYPE: process.env.CLOUDINARY_RESOURCE_TYPE || 'raw',
        CONFIGURED: cloudinaryConfigured
    },

    // Excel processing configuration
    MAX_PREVIEW_SHEETS: parseNumber(process.env.MAX_PREVIEW_SHEETS, 15),

    // Achievement system
    POINTS_PER_COMPLETION: parseNumber(process.env.POINTS_PER_COMPLETION, 10),
    POINTS_PER_LEVEL: parseNumber(process.env.POINTS_PER_LEVEL, 100),

    // Supported file extensions for preview
    TEXT_EXTENSIONS: [
        '.txt', '.md', '.json', '.csv', '.log', '.xml',
        '.html', '.css', '.js', '.py', '.java', '.cpp',
        '.c', '.php', '.rb', '.go', '.rs', '.yml',
        '.yaml', '.ini', '.cfg', '.conf'
    ],

    // Supported file extensions for special preview (XLSX)
    XLSX_EXTENSIONS: ['.xlsx', '.xls'],

    // Achievement milestones
    ACHIEVEMENT_MILESTONES: [
        { count: 1, title: 'First Steps', description: 'Completed your first topic!' },
        { count: 5, title: 'Getting Started', description: 'Completed 5 topics!' },
        { count: 10, title: 'Making Progress', description: 'Completed 10 topics!' },
        { count: 20, title: 'Halfway There', description: 'Completed 20 topics!' },
        { count: 50, title: 'Expert Level', description: 'Completed 50 topics!' }
    ]
};