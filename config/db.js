const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('./logger');
const dbPath = path.join(__dirname, '..', 'database', 'database.sqlite');

logger.info('Initializing SQLite database connection...');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        logger.error('Error opening database:', { message: err.message, stack: err.stack });
    } else {
        logger.info('Connected to SQLite database.');
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                first_name TEXT UNIQUE NOT NULL,
                thread_id TEXT NOT NULL,
                class_schedules TEXT,
                all_assignments TEXT
            )
        `, (err) => {
            if (err) {
                logger.error('Error creating users table:', { message: err.message, stack: err.stack });
            } else {
                logger.info('Users table is ready.');
            }
        });
    }
});

db.on('trace', (sql) => {
    logger.debug('Executing SQL:', sql);
});

module.exports = db;
