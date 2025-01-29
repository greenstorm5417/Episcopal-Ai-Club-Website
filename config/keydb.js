const Redis = require('ioredis');
const logger = require('./logger');

logger.info('Initializing KeyDB (Redis) client...');

const redisClient = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    db: process.env.REDIS_DB || 0,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn('KeyDB retry attempt #%s in %sms', times, delay);
        return delay;
    },
    enableReadyCheck: true
});

// Explicitly bind required methods for connect-redis compatibility
redisClient.get = redisClient.get.bind(redisClient);
redisClient.set = redisClient.set.bind(redisClient);
redisClient.del = redisClient.del.bind(redisClient);
redisClient.ttl = redisClient.ttl.bind(redisClient);
redisClient.expire = redisClient.expire.bind(redisClient);
redisClient.quit = redisClient.quit.bind(redisClient);

redisClient.on('connect', () => {
    logger.info('Connected to KeyDB!');
});

redisClient.on('ready', () => {
    logger.info('KeyDB client is ready to use.');
});

redisClient.on('error', (err) => {
    logger.error('KeyDB connection error:', { 
        message: err.message, 
        stack: err.stack 
    });
});

redisClient.on('reconnecting', (delay) => {
    logger.warn('Reconnecting to KeyDB in %sms...', delay);
});

redisClient.on('end', () => {
    logger.warn('KeyDB connection closed.');
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    try {
        await redisClient.quit();
        logger.info('KeyDB connection closed successfully');
    } catch (error) {
        logger.error('Error closing KeyDB connection:', error);
    }
});

process.on('SIGINT', async () => {
    try {
        await redisClient.quit();
        logger.info('KeyDB connection closed successfully');
    } catch (error) {
        logger.error('Error closing KeyDB connection:', error);
    }
});

module.exports = redisClient;