const Redis = require('ioredis');
const logger = require('./logger');

logger.info('Initializing KeyDB (Redis) client...');

const redisClient = new Redis({
  host: '127.0.0.1',
  port: 6379,
  retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      logger.warn('KeyDB retry attempt #%s in %sms', times, delay);
      return delay;
  },
});

redisClient.on('connect', () => {
  logger.info('Connected to KeyDB!');
});

redisClient.on('ready', () => {
  logger.info('KeyDB client is ready to use.');
});

redisClient.on('error', (err) => {
  logger.error('KeyDB connection error:', { message: err.message, stack: err.stack });
});

redisClient.on('reconnecting', (delay) => {
  logger.warn('Reconnecting to KeyDB in %sms...', delay);
});

redisClient.on('end', () => {
  logger.warn('KeyDB connection closed.');
});

module.exports = redisClient;
