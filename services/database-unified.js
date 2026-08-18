const { Pool } = require('pg');
const config = require('../config/app-config');
const SqliteDatabaseService = require('./database');

function resolvePgSslConfig(connectionString) {
	const explicitDisable = String(process.env.PG_SSL || '').toLowerCase() === 'false';
	if (explicitDisable) {
		return false;
	}

	const explicitEnable = String(process.env.PG_SSL || '').toLowerCase() === 'true';
	const rejectUnauthorized = String(process.env.PG_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true';
	const neonOrSupabase = /neon\.tech|supabase\.co/i.test(String(connectionString || ''));
	const sslModeRequire = /sslmode=require/i.test(String(connectionString || ''));

	if (explicitEnable || neonOrSupabase || sslModeRequire) {
		return { rejectUnauthorized };
	}

	return false;
}

class PostgresCompatDatabase {
	constructor(pool) {
		this.pool = pool;
		this._queue = Promise.resolve();
	}

	serialize(callback) {
		if (typeof callback === 'function') {
			callback();
		}
	}

	_enqueue(operation) {
		this._queue = this._queue.then(operation, operation);
		return this._queue;
	}

	_normalizeSql(sql) {
		let normalized = String(sql || '');
		normalized = normalized.replace(/datetime\('now',\s*'utc'\)/gi, 'CURRENT_TIMESTAMP');
		normalized = normalized.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
		normalized = normalized.replace(/\bAUTOINCREMENT\b/gi, '');
		return normalized;
	}

	_convertPlaceholders(sql) {
		let index = 0;
		return sql.replace(/\?/g, () => `$${++index}`);
	}

	_prepareSql(sql) {
		return this._convertPlaceholders(this._normalizeSql(sql));
	}

	_shouldAppendReturningId(sql) {
		const source = String(sql || '').trim().toLowerCase();
		return source.startsWith('insert ') && !/\breturning\b/.test(source);
	}

	_execute(sql, params = []) {
		const preparedSql = this._prepareSql(sql);
		const finalSql = this._shouldAppendReturningId(preparedSql)
			? `${preparedSql} RETURNING id`
			: preparedSql;

		return this.pool.query(finalSql, params);
	}

	run(sql, params, callback) {
		const safeParams = typeof params === 'function' || params === undefined ? [] : params;
		const safeCallback = typeof params === 'function' ? params : callback;

		this._enqueue(async () => {
			try {
				const result = await this._execute(sql, safeParams);
				if (typeof safeCallback === 'function') {
					const firstRow = result.rows && result.rows.length > 0 ? result.rows[0] : null;
					const context = {
						lastID: firstRow && Object.prototype.hasOwnProperty.call(firstRow, 'id') ? firstRow.id : null,
						changes: Number(result.rowCount) || 0
					};
					safeCallback.call(context, null);
				}
			} catch (error) {
				if (typeof safeCallback === 'function') {
					safeCallback.call({ lastID: null, changes: 0 }, error);
					return;
				}
				throw error;
			}
		});
	}

	get(sql, params, callback) {
		const safeParams = typeof params === 'function' || params === undefined ? [] : params;
		const safeCallback = typeof params === 'function' ? params : callback;

		this._enqueue(async () => {
			try {
				const result = await this._execute(sql, safeParams);
				if (typeof safeCallback === 'function') {
					safeCallback(null, result.rows[0] || undefined);
				}
			} catch (error) {
				if (typeof safeCallback === 'function') {
					safeCallback(error);
					return;
				}
				throw error;
			}
		});
	}

	all(sql, params, callback) {
		const safeParams = typeof params === 'function' || params === undefined ? [] : params;
		const safeCallback = typeof params === 'function' ? params : callback;

		this._enqueue(async () => {
			try {
				const result = await this._execute(sql, safeParams);
				if (typeof safeCallback === 'function') {
					safeCallback(null, result.rows || []);
				}
			} catch (error) {
				if (typeof safeCallback === 'function') {
					safeCallback(error);
					return;
				}
				throw error;
			}
		});
	}

	prepare(sql) {
		const operations = [];
		const executeStatement = (params = []) => {
			return this._enqueue(() => this._execute(sql, params));
		};

		return {
			run: (params = [], callback) => {
				const op = executeStatement(params)
					.then((result) => {
						if (typeof callback === 'function') {
							const firstRow = result.rows && result.rows.length > 0 ? result.rows[0] : null;
							callback.call(
								{
									lastID: firstRow && Object.prototype.hasOwnProperty.call(firstRow, 'id') ? firstRow.id : null,
									changes: Number(result.rowCount) || 0
								},
								null
							);
						}
					})
					.catch((error) => {
						if (typeof callback === 'function') {
							callback.call({ lastID: null, changes: 0 }, error);
							return;
						}
						throw error;
					});

				operations.push(op);
			},
			finalize: (callback) => {
				Promise.all(operations)
					.then(() => {
						if (typeof callback === 'function') {
							callback(null);
						}
					})
					.catch((error) => {
						if (typeof callback === 'function') {
							callback(error);
						}
					});
			}
		};
	}

	close(callback) {
		this.pool
			.end()
			.then(() => {
				if (typeof callback === 'function') {
					callback(null);
				}
			})
			.catch((error) => {
				if (typeof callback === 'function') {
					callback(error);
				}
			});
	}
}

class PostgresDatabaseService {
	constructor() {
		if (!config.DATABASE_URL) {
			throw new Error('DATABASE_URL is required when using Postgres.');
		}

		this.pool = new Pool({
			connectionString: config.DATABASE_URL,
			ssl: resolvePgSslConfig(config.DATABASE_URL)
		});
		this.db = new PostgresCompatDatabase(this.pool);
		this.initializeTables();
	}

	initializeTables() {
		const bootstrapStatements = [
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
			`CREATE TABLE IF NOT EXISTS quiz_questions (
				id SERIAL PRIMARY KEY,
				topic_id INTEGER NOT NULL,
				question_text TEXT NOT NULL,
				options TEXT NOT NULL,
				correct_index INTEGER NOT NULL,
				explanation TEXT,
				times_seen INTEGER DEFAULT 0,
				times_correct INTEGER DEFAULT 0,
				interval_days INTEGER DEFAULT 0,
				next_review_at TEXT,
				last_answered_at TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
			`CREATE INDEX IF NOT EXISTS idx_time_tracking_sessions_start_time
				ON time_tracking_sessions(start_time)`,
			`CREATE INDEX IF NOT EXISTS idx_time_tracking_sessions_status
				ON time_tracking_sessions(status)`,
			`CREATE INDEX IF NOT EXISTS idx_time_tracking_sessions_user
				ON time_tracking_sessions(user_id)`
		];

		this.db.serialize(() => {
			bootstrapStatements.forEach((statement) => {
				this.db.run(statement, (err) => {
					if (err) {
						console.error('Postgres bootstrap statement failed:', err.message);
					}
				});
			});
		});
	}

	updateProgress() {
		const query = `
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
				SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress
			FROM topics
		`;

		this.db.get(query, (err, row) => {
			if (err) {
				return;
			}

			const points = Number(row.completed || 0) * config.POINTS_PER_COMPLETION;
			const level = Math.floor(points / config.POINTS_PER_LEVEL) + 1;

			this.db.run(
				`INSERT INTO progress (id, total_topics, completed_topics, in_progress_topics, points, level)
				 VALUES (1, ?, ?, ?, ?, ?)
				 ON CONFLICT (id) DO UPDATE SET
					total_topics = EXCLUDED.total_topics,
					completed_topics = EXCLUDED.completed_topics,
					in_progress_topics = EXCLUDED.in_progress_topics,
					points = EXCLUDED.points,
					level = EXCLUDED.level,
					updated_at = CURRENT_TIMESTAMP`,
				[Number(row.total || 0), Number(row.completed || 0), Number(row.in_progress || 0), points, level]
			);
		});
	}

	close(callback) {
		this.db.close(callback);
	}
}

const sqlitePrototypeMethods = Object.getOwnPropertyNames(SqliteDatabaseService.prototype)
	.filter((name) => !['constructor', 'initializeTables', 'updateProgress'].includes(name));

sqlitePrototypeMethods.forEach((name) => {
	if (typeof SqliteDatabaseService.prototype[name] === 'function') {
		PostgresDatabaseService.prototype[name] = SqliteDatabaseService.prototype[name];
	}
});

class UnifiedDatabaseService {
	constructor() {
		this.provider = 'sqlite';
		this.impl = null;

		const wantsPostgres = !config.FORCE_SQLITE && (
			config.DATABASE_PROVIDER === 'postgres' || Boolean(config.DATABASE_URL)
		);

		if (wantsPostgres) {
			try {
				this.impl = new PostgresDatabaseService();
				this.provider = 'postgres';
			} catch (error) {
				console.error('[Database] Postgres initialization failed:', error.message);
				if (!config.ALLOW_SQLITE_FALLBACK) {
					throw error;
				}
				console.warn('[Database] Falling back to SQLite due to configuration.');
			}
		}

		if (!this.impl) {
			this.impl = new SqliteDatabaseService();
			this.provider = 'sqlite';
		}

		this.db = this.impl.db;
		this.isPostgres = this.provider === 'postgres';
		console.log(`[Database] Provider: ${this.provider}`);
	}

	getProviderInfo() {
		return {
			provider: this.provider,
			isPostgres: this.isPostgres,
			isSqlite: !this.isPostgres
		};
	}

	close(callback) {
		if (this.impl && typeof this.impl.close === 'function') {
			return this.impl.close(callback);
		}

		if (typeof callback === 'function') {
			callback(null);
		}
	}
}

const unifiedMethodNames = new Set([
	...Object.getOwnPropertyNames(SqliteDatabaseService.prototype),
	...Object.getOwnPropertyNames(PostgresDatabaseService.prototype)
]);

unifiedMethodNames.forEach((methodName) => {
	if (methodName === 'constructor' || methodName === 'getProviderInfo') {
		return;
	}

	if (typeof SqliteDatabaseService.prototype[methodName] !== 'function'
		&& typeof PostgresDatabaseService.prototype[methodName] !== 'function') {
		return;
	}

	if (typeof UnifiedDatabaseService.prototype[methodName] === 'function') {
		return;
	}

	UnifiedDatabaseService.prototype[methodName] = function proxyMethod(...args) {
		return this.impl[methodName](...args);
	};
});

module.exports = UnifiedDatabaseService;
module.exports.PostgresDatabaseService = PostgresDatabaseService;
module.exports.resolvePgSslConfig = resolvePgSslConfig;
