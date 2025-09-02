module.exports = {
    // Server configuration
    PORT: process.env.PORT || 3000,
    
    // Database configuration
    DATABASE_PATH: './learning_progress.db',
    DATABASE_URL: process.env.DATABASE_URL, // PostgreSQL connection string for production
    
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