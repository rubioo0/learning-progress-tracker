const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const config = require('../config/app-config');

const inputPath = process.argv[2];
const clearBeforeImport = process.argv.includes('--clear');

if (!inputPath) {
    console.error('Usage: node scripts/import-json-state-to-sqlite.js <json-path> [--clear]');
    process.exit(1);
}

const resolvedInputPath = path.resolve(process.cwd(), inputPath);
if (!fs.existsSync(resolvedInputPath)) {
    console.error(`File not found: ${resolvedInputPath}`);
    process.exit(1);
}

function normalizeTopics(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (payload && Array.isArray(payload.topics)) {
        return payload.topics;
    }

    if (payload && payload.topics && Array.isArray(payload.topics.data)) {
        return payload.topics.data;
    }

    throw new Error('Unsupported JSON shape. Expected topics array or complete-backup structure.');
}

function toQuestionsJson(value) {
    if (!value) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value);
    } catch (error) {
        return null;
    }
}

function extractAttachment(topic) {
    if (topic && topic.attachment && typeof topic.attachment === 'object') {
        return {
            filename: topic.attachment.filename || null,
            original_name: topic.attachment.original_name || topic.attachment.originalName || null,
            path: topic.attachment.path || topic.attachment.url || null
        };
    }

    return {
        filename: topic.attachment_filename || null,
        original_name: topic.attachment_original_name || null,
        path: topic.attachment_path || null
    };
}

let payload;
try {
    payload = JSON.parse(fs.readFileSync(resolvedInputPath, 'utf8'));
} catch (error) {
    console.error(`Failed to parse JSON: ${error.message}`);
    process.exit(1);
}

let topics;
try {
    topics = normalizeTopics(payload);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

if (!Array.isArray(topics) || topics.length === 0) {
    console.error('No topics found in provided JSON.');
    process.exit(1);
}

const db = new sqlite3.Database(config.DATABASE_PATH);

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve(this);
        });
    });
}

async function importTopics() {
    console.log(`Import source: ${resolvedInputPath}`);
    console.log(`Topics detected: ${topics.length}`);
    console.log(`SQLite target: ${config.DATABASE_PATH}`);

    await run('BEGIN');

    try {
        if (clearBeforeImport) {
            await run('DELETE FROM topics');
            console.log('Cleared existing topics table.');
        }

        const sql = `INSERT INTO topics (
            title,
            description,
            category,
            module,
            status,
            notes,
            questions,
            attachment_filename,
            attachment_original_name,
            attachment_path,
            order_index,
            generated_content,
            generation_status,
            generated_at,
            generated_model,
            generation_meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        let imported = 0;

        for (let index = 0; index < topics.length; index += 1) {
            const topic = topics[index] || {};
            const attachment = extractAttachment(topic);

            if (!topic.title || String(topic.title).trim().length === 0) {
                continue;
            }

            await run(sql, [
                String(topic.title || '').trim(),
                topic.description || '',
                topic.category || '',
                topic.module || '',
                topic.status || 'not-started',
                topic.notes || '',
                toQuestionsJson(topic.questions),
                attachment.filename,
                attachment.original_name,
                attachment.path,
                Number.isFinite(Number(topic.order_index)) ? Number(topic.order_index) : index + 1,
                topic.generated_content || null,
                topic.generation_status || null,
                topic.generated_at || null,
                topic.generated_model || null,
                topic.generation_meta ? (typeof topic.generation_meta === 'string' ? topic.generation_meta : JSON.stringify(topic.generation_meta)) : null
            ]);

            imported += 1;
        }

        await run('COMMIT');
        console.log(`Import completed. Topics imported: ${imported}`);
    } catch (error) {
        await run('ROLLBACK');
        throw error;
    }
}

importTopics()
    .then(() => db.close())
    .catch((error) => {
        console.error(`Import failed: ${error.message}`);
        db.close();
        process.exit(1);
    });
