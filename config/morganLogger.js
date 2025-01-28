const logger = require('./logger');

const morganStream = {
    write: (message) => {
        logger.info(message.trim());
    },
};

module.exports = morganStream;
