module.exports = {
    // Server configuration
    PORT: process.env.PORT || 3000,

    // AI model configuration
    AI_MODELS: [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'free', recommended: true },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', tier: 'free' },
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tier: 'free' }
    ],
    AI_DEFAULT_MODEL: 'gemini-2.5-flash',
    AI_FALLBACK_ORDER: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    AI_RETRY: {
        maxRetriesPerModel: 3,
        baseDelayMs: 3000,
        maxDelayMs: 15000,
        jitterMs: 700
    },
    AI_EXPLAIN_RATE_LIMIT: {
        windowMs: 60000,
        maxRequests: 10,
        cooldownMs: 15000,
        cacheTtlMs: 10 * 60 * 1000,
        maxTermLength: 350
    },

    // Code validation settings (used in fullscreen edit mode)
    CODE_VALIDATION: {
        timeoutMs: 12000,
        dotnetTimeoutMs: 20000,
        maxDiagnostics: 8,
        maxCodeLength: 50000
    },
    
    // Database configuration
    DATABASE_PATH: './learning_progress.db',
    
    // File upload configuration
    UPLOAD_DIRECTORY: 'uploads/',
    MAX_PREVIEW_FILE_SIZE: 200 * 1024,
    
    // Excel processing configuration
    MAX_PREVIEW_SHEETS: 15,
    
    // Achievement system
    POINTS_PER_COMPLETION: 10,
    POINTS_PER_LEVEL: 100,
    
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
        { count: 1, title: "First Steps", description: "Completed your first topic!" },
        { count: 5, title: "Getting Started", description: "Completed 5 topics!" },
        { count: 10, title: "Making Progress", description: "Completed 10 topics!" },
        { count: 20, title: "Halfway There", description: "Completed 20 topics!" },
        { count: 50, title: "Expert Level", description: "Completed 50 topics!" }
    ]
};