const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const {RedisStore} = require("connect-redis")
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const routes = require('./routes');
const logger = require('./config/logger'); 
const morganStream = require('./config/morganLogger'); 
const keydbClient = require('./config/keydb');
const db = require('./config/db');



dotenv.config();

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', { message: error.message, stack: error.stack });
});


const app = express();
const PORT = process.env.PORT || 3000;

const logDirectory = path.join(__dirname, 'logs');
fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory);

app.use(morgan('combined', { stream: morganStream }));

app.use(session({
    secret: process.env.SESSION_SECRET ,
    resave: false,
    saveUninitialized: false,
    store: new RedisStore({ client: keydbClient }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
}));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
            styleSrc: ["'self'",  "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:"],
        },
    },
}));

const limiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 min
    max: 100, 
    message: 'Too many requests from this IP, please try again after 5 minutes',
});
app.use(limiter);

app.use(compression({
    level: 6,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    },
    threshold: 0,
}));



app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));


app.use('/', routes);

app.get('/', (req, res) => {
    const redirectTo = req.session.firstName ? '/chat' : '/login';
    logger.info('Root access. Redirecting to %s for user: %s', redirectTo, req.session.firstName || 'Guest');
    res.redirect(redirectTo);
});

app.use((err, req, res, next) => {
    logger.error('Unhandled error in Express route:', { message: err.message, stack: err.stack });
    if (process.env.NODE_ENV === 'production') {
        res.status(500).send('Something went wrong! Please try again later.');
    } else {
        res.status(500).send(`Error: ${err.message}`);
    }
});

const server = app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
});

const shutdown = async () => {
    logger.info('Received kill signal, shutting down gracefully.');
    
    try {
        await new Promise((resolve, reject) => {
            server.close((err) => {
                if (err) {
                    logger.warning('Error closing the server:', { message: err.message, stack: err.stack });
                    reject(err);
                } else {
                    logger.info('Server closed successfully.');
                    resolve();
                }
            });
        });

        await keydbClient.quit();
        logger.info('Redis client closed successfully.');

        await new Promise((resolve, reject) => {
            db.close((err) => {
                if (err) {
                    logger.warning('Error closing SQLite database:', { message: err.message, stack: err.stack });
                    reject(err);
                } else {
                    logger.info('SQLite database closed successfully.');
                    resolve();
                }
            });
        });
    } catch (err) {
        logger.warning('Error during shutdown:', { message: err.message, stack: err.stack });
    } finally {
        process.exit(0);
    }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
