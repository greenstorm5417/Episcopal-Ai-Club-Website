const { createLogger, format, transports } = require('winston');
const path = require('path');
const DailyRotateFile = require('winston-daily-rotate-file');
const fs = require('fs');

const logDirectory = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory, { recursive: true });
}

const logger = createLogger({
    level: 'debug',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }), 
        format.splat(),
        format.json()
    ),
    defaultMeta: { service: 'ai-club-website' },
    transports: [
        new DailyRotateFile({
            filename: path.join(logDirectory, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d',
            level: 'error',
        }),
        
        new DailyRotateFile({
            filename: path.join(logDirectory, 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d',
        }),
    ],
});

// If we're not in production, log to the console
if (false) {
    logger.add(new transports.Console({
        format: format.combine(
            format.colorize(),
            format.simple()
        )
    }));
}

module.exports = logger;
