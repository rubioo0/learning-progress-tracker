const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');

const config = require('../config/app-config');
const { resolvePgSslConfig } = require('../services/database-unified');

const sqliteFilePath = path.resolve(process.cwd(), process.argv[2] || config.DATABASE_PATH || './learning_progress.db');
const postgresUrl = config.DATABASE_URL;

function fail(message) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

if (!postgresUrl) {
    fail('DATABASE_URL is required for migration.');
}

if (!fs.existsSync(sqliteFilePath)) {
    fail(`SQLite database file not found: ${sqliteFilePath}`);
}

function sqliteAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    });
}

function sqliteGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row || null);
        });
    });
}

async function sqliteTableExists(db, tableName) {
    const row = await sqliteGet(
        db,
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        [tableName]
    );

    return Boolean(row && row.name);
}

async function sqliteTableColumns(db, tableName) {
    const rows = await sqliteAll(db, `PRAGMA table_info(${tableName})`);
    return new Set(rows.map((row) => String(row.name || '').trim()).filter(Boolean));
}

function placeholders(count) {
    return Array.from({ length: count }, (_, index) => `$${index + 1}`).join(', ');
}

function buildUpsertSql(tableName, columns, conflictColumn = 'id') {
    const insertColumns = columns.join(', ');
    const updateColumns = columns.filter((column) => column !== conflictColumn);

    if (updateColumns.length === 0) {
        return `INSERT INTO ${tableName} (${insertColumns}) VALUES (${placeholders(columns.length)}) ON CONFLICT (${conflictColumn}) DO NOTHING`;
    }

    const updates = updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(', ');
    return `INSERT INTO ${tableName} (${insertColumns}) VALUES (${placeholders(columns.length)}) ON CONFLICT (${conflictColumn}) DO UPDATE SET ${updates}`;
}

async function bootstrapPostgresSchema(pool) {
    const statements = [
        `CREATE TABLE IF NOT EXISTS topics (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT,
            module TEXT,
            status TEXT DEFAULT 'not-started',
            notes TEXT,
            questions TEXT,
            attachment_filename TEXT,
            attachment_original_name TEXT,
            attachment_path TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            order_index INTEGER,
            generated_content TEXT,
            generation_status TEXT,
            generated_at TEXT,
            generated_model TEXT,
            generation_meta TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS learning_notes (
            id SERIAL PRIMARY KEY,
            term TEXT NOT NULL,
            explanation TEXT NOT NULL,
            source_topic_id INTEGER,
            source_topic_title TEXT,
            source_context TEXT,
            model_used TEXT,
            review_count INTEGER DEFAULT 0,
            last_reviewed TEXT,
            mastered INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS sessions (
            id SERIAL PRIMARY KEY,
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP,
            duration INTEGER,
            elapsed_minutes INTEGER,
            topic_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS progress (
            id INTEGER PRIMARY KEY,
            total_topics INTEGER,
            completed_topics INTEGER,
            in_progress_topics INTEGER,
            points INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS achievements (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            type TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS time_tracking_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT DEFAULT 'default_user',
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_seconds INTEGER,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            timezone_offset INTEGER,
            session_data TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS idx_time_tracking_sessions_start_time ON time_tracking_sessions(start_time)`,
        `CREATE INDEX IF NOT EXISTS idx_time_tracking_sessions_status ON time_tracking_sessions(status)`,
        `CREATE INDEX IF NOT EXISTS idx_time_tracking_sessions_user ON time_tracking_sessions(user_id)`
    ];

    for (const statement of statements) {
        await pool.query(statement);
    }
}

async function migrateTable(sqliteDb, pgPool, tableName, columns, conflictColumn = 'id') {
    const tableExists = await sqliteTableExists(sqliteDb, tableName);
    if (!tableExists) {
        console.log(`- ${tableName}: source table not found in SQLite, skipping`);
        return;
    }

    const availableColumns = await sqliteTableColumns(sqliteDb, tableName);
    const missingColumns = columns.filter((column) => !availableColumns.has(column));

    const selectColumns = columns.map((column) => {
        if (availableColumns.has(column)) {
            return column;
        }

        return `NULL AS ${column}`;
    });

    const rows = await sqliteAll(sqliteDb, `SELECT ${selectColumns.join(', ')} FROM ${tableName}`);
    if (rows.length === 0) {
        console.log(`- ${tableName}: no rows to migrate`);
        return;
    }

    if (missingColumns.length > 0) {
        console.log(`- ${tableName}: missing source columns mapped to NULL: ${missingColumns.join(', ')}`);
    }

    const upsertSql = buildUpsertSql(tableName, columns, conflictColumn);

    for (const row of rows) {
        const values = columns.map((column) => (row[column] === undefined ? null : row[column]));
        await pgPool.query(upsertSql, values);
    }

    console.log(`- ${tableName}: migrated ${rows.length} row(s)`);
}

async function syncSequences(pgPool) {
    const sequenceTables = ['topics', 'learning_notes', 'sessions', 'achievements'];

    for (const tableName of sequenceTables) {
        await pgPool.query(
            `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${tableName}), 1), true)`,
            [tableName]
        );
    }
}

async function runMigration() {
    const sqliteDb = new sqlite3.Database(sqliteFilePath);
    const pgPool = new Pool({
        connectionString: postgresUrl,
        ssl: resolvePgSslConfig(postgresUrl)
    });

    const tableDefinitions = [
        {
            tableName: 'topics',
            columns: [
                'id',
                'title',
                'description',
                'category',
                'module',
                'status',
                'notes',
                'questions',
                'attachment_filename',
                'attachment_original_name',
                'attachment_path',
                'created_at',
                'updated_at',
                'order_index',
                'generated_content',
                'generation_status',
                'generated_at',
                'generated_model',
                'generation_meta'
            ]
        },
        {
            tableName: 'learning_notes',
            columns: [
                'id',
                'term',
                'explanation',
                'source_topic_id',
                'source_topic_title',
                'source_context',
                'model_used',
                'review_count',
                'last_reviewed',
                'mastered',
                'created_at',
                'updated_at'
            ]
        },
        {
            tableName: 'sessions',
            columns: [
                'id',
                'start_time',
                'end_time',
                'duration',
                'elapsed_minutes',
                'topic_id',
                'created_at'
            ]
        },
        {
            tableName: 'progress',
            columns: [
                'id',
                'total_topics',
                'completed_topics',
                'in_progress_topics',
                'points',
                'level',
                'updated_at'
            ]
        },
        {
            tableName: 'achievements',
            columns: [
                'id',
                'title',
                'description',
                'earned_at',
                'type'
            ]
        },
        {
            tableName: 'time_tracking_sessions',
            columns: [
                'id',
                'user_id',
                'start_time',
                'end_time',
                'duration_seconds',
                'status',
                'created_at',
                'updated_at',
                'timezone_offset',
                'session_data'
            ]
        }
    ];

    try {
        console.log('Bootstrapping Postgres schema...');
        await bootstrapPostgresSchema(pgPool);

        console.log('Starting migration transaction...');
        await pgPool.query('BEGIN');

        for (const tableDef of tableDefinitions) {
            await migrateTable(sqliteDb, pgPool, tableDef.tableName, tableDef.columns, 'id');
        }

        await syncSequences(pgPool);
        await pgPool.query('COMMIT');

        console.log('Migration completed successfully.');
    } catch (error) {
        await pgPool.query('ROLLBACK').catch(() => null);
        console.error('Migration failed:', error.message);
        process.exitCode = 1;
    } finally {
        sqliteDb.close();
        await pgPool.end();
    }
}

runMigration();
