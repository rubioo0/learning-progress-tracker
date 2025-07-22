const fs = require('fs');
const path = require('path');
const config = require('../config/app-config');

/**
 * Handle database errors consistently
 */
function handleDatabaseError(res, err, message = 'Database error') {
    console.error(`${message}:`, err);
    res.status(500).json({ error: err.message });
}

/**
 * Calculate progress statistics and points
 */
function calculateProgress(row) {
    const completionPercentage = row.total_topics > 0 ? 
        Math.round((row.completed_topics / row.total_topics) * 100) : 0;
    const points = row.completed_topics * config.POINTS_PER_COMPLETION;
    const level = Math.floor(points / config.POINTS_PER_LEVEL) + 1;
    
    return { 
        ...row, 
        completion_percentage: completionPercentage, 
        points, 
        level 
    };
}

/**
 * Clean up uploaded files
 */
function cleanupFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
        } catch (error) {
            console.error('Error cleaning up file:', error);
        }
    }
}

/**
 * Check if file type is supported for preview
 */
function isSupportedFileType(filename) {
    const fileExt = path.extname(filename).toLowerCase();
    return config.TEXT_EXTENSIONS.includes(fileExt) || config.XLSX_EXTENSIONS.includes(fileExt);
}

/**
 * Get the file type category for preview handling
 */
function getFileTypeCategory(filename) {
    const fileExt = path.extname(filename).toLowerCase();
    
    if (config.TEXT_EXTENSIONS.includes(fileExt)) {
        return 'text';
    } else if (config.XLSX_EXTENSIONS.includes(fileExt)) {
        return 'xlsx';
    }
    
    return 'unknown';
}

/**
 * Check if file is XLSX type
 */
function isXlsxFileType(filename) {
    const fileExt = path.extname(filename).toLowerCase();
    return config.XLSX_EXTENSIONS.includes(fileExt);
}

/**
 * Validate file size for preview
 */
function isValidPreviewSize(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return stats.size <= config.MAX_PREVIEW_FILE_SIZE;
    } catch (error) {
        return false;
    }
}

/**
 * Build a comprehensive topic description from parsed data
 */
function buildTopicDescription(taskData) {
    const sections = [
        { key: 'descriptions', title: 'Descriptions' },
        { key: 'artifacts', title: 'Artifacts' },
        { key: 'neboTasks', title: 'NEBo Tasks' },
        { key: 'outcomes', title: 'Outcomes' },
        { key: 'learningResources', title: 'Learning Resources' },
        { key: 'other', title: 'Additional Information' }
    ];
    
    const descriptionParts = sections
        .filter(section => taskData[section.key] && taskData[section.key].length > 0)
        .map(section => `**${section.title}:**\n${taskData[section.key].join('\n• ')}`);
    
    return descriptionParts.length > 0 ? 
        descriptionParts.join('\n\n') : 
        'No detailed description available.';
}

/**
 * Parse Excel sheet data into structured tasks
 */
function parseExcelSheet(worksheet) {
    const XLSX = require('xlsx');
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
    const tasks = {};
    let currentLevel = '';
    let currentTask = '';
    let currentSectionType = '';

    rawData.forEach((row) => {
        if (row.length >= 4) {
            const level = row[0] ? row[0].toString().trim() : '';
            const task = row[1] ? row[1].toString().trim() : '';
            const sectionType = row[2] ? row[2].toString().trim().toLowerCase() : '';
            const content = row[3] ? row[3].toString().trim() : '';

            // Update tracking variables
            if (level) currentLevel = level;
            if (task) {
                currentTask = task;
                if (!tasks[currentTask]) {
                    tasks[currentTask] = {
                        level: currentLevel,
                        task: currentTask,
                        descriptions: [],
                        artifacts: [],
                        neboTasks: [],
                        outcomes: [],
                        learningResources: [],
                        other: []
                    };
                }
            }
            if (sectionType) currentSectionType = sectionType;

            // Categorize content
            if (currentTask && content && tasks[currentTask]) {
                categorizeContent(tasks[currentTask], currentSectionType, content);
            }
        }
    });

    return tasks;
}

/**
 * Categorize content based on section type
 */
function categorizeContent(task, sectionType, content) {
    if (sectionType.includes('description')) {
        task.descriptions.push(content);
    } else if (sectionType.includes('artifact')) {
        task.artifacts.push(content);
    } else if (sectionType.includes('nebo') || (sectionType.includes('task') && !sectionType.includes('name'))) {
        task.neboTasks.push(content);
    } else if (sectionType.includes('outcome')) {
        task.outcomes.push(content);
    } else if (sectionType.includes('learning') || sectionType.includes('resource')) {
        task.learningResources.push(content);
    } else if (sectionType) {
        task.other.push(`${sectionType}: ${content}`);
    } else {
        task.descriptions.push(content);
    }
}

/**
 * Extract sheet preview data
 */
function extractSheetPreview(worksheet, sheetName, index) {
    let level = 'Not found';
    let taskName = 'Not found';

    try {
        const levelCell = worksheet['A1'];
        const taskNameCell = worksheet['B1'];
        
        level = levelCell && levelCell.v ? levelCell.v.toString().trim() : 'Not found';
        taskName = taskNameCell && taskNameCell.v ? taskNameCell.v.toString().trim() : 'Not found';
    } catch (cellError) {
        level = 'Error reading';
        taskName = 'Error reading';
    }

    const structureData = [];
    for (let row = 1; row <= 15; row++) {
        try {
            const cCell = worksheet[`C${row}`];
            const dCell = worksheet[`D${row}`];
            
            if (cCell && cCell.v) {
                const label = cCell.v.toString().trim();
                const value = dCell && dCell.v ? dCell.v.toString().substring(0, 150) : '(empty)';
                
                if (label && value !== '(empty)') {
                    structureData.push({
                        row: row,
                        label: label,
                        value: value + (dCell && dCell.v && dCell.v.toString().length > 150 ? '...' : '')
                    });
                }
            }
        } catch (rowError) {
            // Skip problematic rows silently
        }
    }

    return {
        sheetName,
        index: index + 1,
        level,
        taskName,
        structureData: structureData,
        dataFound: structureData.length > 0
    };
}

/**
 * Parse XLSX file for preview
 */
function parseXlsxForPreview(filePath) {
    const XLSX = require('xlsx');
    
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetsPreview = [];
        
        // Limit to first 3 sheets for preview
        workbook.SheetNames.slice(0, 3).forEach((sheetName, index) => {
            try {
                const worksheet = workbook.Sheets[sheetName];
                if (worksheet) {
                    const sheetPreview = extractSheetPreview(worksheet, sheetName, index);
                    sheetsPreview.push(sheetPreview);
                }
            } catch (sheetError) {
                sheetsPreview.push({
                    sheetName,
                    index: index + 1,
                    level: 'Error reading',
                    taskName: 'Error reading',
                    error: sheetError.message,
                    structureData: []
                });
            }
        });
        
        return {
            totalSheets: workbook.SheetNames.length,
            sheetNames: workbook.SheetNames,
            sheetsPreview,
            success: true
        };
    } catch (error) {
        return {
            error: error.message,
            success: false
        };
    }
}

module.exports = {
    handleDatabaseError,
    calculateProgress,
    cleanupFile,
    isSupportedFileType,
    isXlsxFileType,
    isValidPreviewSize,
    getFileTypeCategory,
    buildTopicDescription,
    parseExcelSheet,
    extractSheetPreview,
    parseXlsxForPreview
};
