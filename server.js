const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const { RedisStore } = require("connect-redis");
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const https = require('https');
const http = require('http');
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

const logDirectory = path.join(__dirname, 'logs');
if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory);
}

app.use(morgan('combined', { stream: morganStream }));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new RedisStore({ client: keydbClient }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24,
    },
}));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
            styleSrc: ["'self'", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
}));

const limiter = rateLimit({
    windowMs: 5 * 60 * 1000,
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

app.set('trust proxy', 1); 

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

if (process.env.NODE_ENV === 'production') {
    const HTTPS_PORT = 443;
    const certPath = 'C:/Certbot/live/greenstorm.site/';
    const sslOptions = {
        key: fs.readFileSync(path.join(certPath, 'privkey.pem')),
        cert: fs.readFileSync(path.join(certPath, 'fullchain.pem')),
    };
    const httpsServer = https.createServer(sslOptions, app);
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        logger.info(`HTTPS Server running on https://0.0.0.0:${HTTPS_PORT}`);
    });
} else {
    const HTTP_PORT = 80;
    const httpApp = express();
    httpApp.use((req, res, next) => {
        const host = req.headers.host.split(':')[0];
        res.redirect(`https://${host}${req.url}`);
    });
    const httpServer = http.createServer(httpApp);
    httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
        logger.info(`HTTP Server running on http://0.0.0.0:${HTTP_PORT} and redirecting to HTTPS`);
    });
}

const shutdown = async () => {
    logger.info('Received kill signal, shutting down gracefully.');

    try {
        if (process.env.NODE_ENV === 'production') {
            await new Promise((resolve, reject) => {
                httpsServer.close((err) => {
                    if (err) {
                        logger.warning('Error closing HTTPS server:', { message: err.message, stack: err.stack });
                        reject(err);
                    } else {
                        logger.info('HTTPS server closed successfully.');
                        resolve();
                    }
                });
            });
        } else {
            await new Promise((resolve, reject) => {
                httpServer.close((err) => {
                    if (err) {
                        logger.warning('Error closing HTTP server:', { message: err.message, stack: err.stack });
                        reject(err);
                    } else {
                        logger.info('HTTP server closed successfully.');
                        resolve();
                    }
                });
            });
        }

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
