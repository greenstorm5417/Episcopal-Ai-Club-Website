const express = require('express');
const router = express.Router();
const { 
    getUser, 
    createUser, 
    updateUserSettings, 
    isAuthenticated, 
    EventHandler, 
    deleteLastMessagePair,
    openai
} = require('../utils');
const path = require('path');
const logger = require('../config/logger'); 
const redisClient = require('../config/keydb');
const db = require('../config/db');

const assistant_id_full = "asst_asKQhGZx0c5pKqFQSltw1iu3";

router.get('/login', (req, res) => 
    res.sendFile(path.join(__dirname, '..', 'public', 'html', 'login.html'))
);

router.post('/login', async (req, res, next) => {
    const trimmedName = (req.body.first_name || '').trim();
    if (!trimmedName) {
        return res.redirect(`/login?error=${encodeURIComponent('First name is required.')}`);
    }

    try {
        let user = await getUser(trimmedName);
        if (!user) {
            const thread = await openai.beta.threads.create();
            await createUser(trimmedName, thread.id);
            logger.info(`Created new user: ${trimmedName} with thread ID: ${thread.id}`);
        }
        req.session.firstName = trimmedName;
        res.redirect('/chat');
    } catch (err) {
        logger.error(`Login Error for user ${trimmedName}: ${err.message}`);
        next(err);
    }
});

router.get('/logout', (req, res, next) => {
    req.session.destroy(err => {
        if (err) {
            logger.error(`Logout Error: ${err.message}`);
            return res.status(500).send('Error logging out');
        } else {
            res.redirect('/login');
        }
    });
});

router.get('/chat', isAuthenticated, (req, res) => 
    res.sendFile(path.join(__dirname, '..', 'public', 'html', 'chat.html'))
);

const handleStreaming = async (res, threadId, assistantId, userId) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const eventHandler = new EventHandler(userId);

    eventHandler.on("data", text => res.write(`data: ${JSON.stringify({ text })}\n\n`));

    eventHandler.on("error", error => {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    });

    try {
        const stream = openai.beta.threads.runs.stream(threadId, { assistant_id: assistantId });

        for await (const event of stream) {
            await eventHandler.onEvent(event);
        }

        eventHandler.buffer.flush();
        let chunk;
        while ((chunk = eventHandler.buffer.getMessage()) !== null) {
            eventHandler.emit('data', chunk);
        }

        res.end();

        res.end();
    } catch (error) {
        logger.error(`Streaming Error for thread ${threadId}: ${error.message}`);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
};

router.post('/assistant/send', isAuthenticated, async (req, res, next) => {
    try {
        const { message } = req.body;
        const userId = req.session.firstName;
        const user = await getUser(userId);

        if (!message?.trim() || !user?.thread_id) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        await openai.beta.threads.messages.create(user.thread_id, { role: "user", content: message });
        logger.info(`User ${userId} sent message: ${message}`);

        await handleStreaming(res, user.thread_id, assistant_id_full, userId);
    } catch (error) {
        logger.error(`Send Message Error for user ${req.session.firstName}: ${error.message}`);
        next(error);
    }
});

router.get('/history', isAuthenticated, async (req, res, next) => {
    try {
        const userId = req.session.firstName;
        const user = await getUser(userId);

        if (!user?.thread_id) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const messages = (await openai.beta.threads.messages.list(user.thread_id, { limit: 50 })).data;
        messages.reverse();
        res.json({ 
            history: messages.map(m => ({ 
                role: m.role, 
                content: m.content[0].text.value 
            })) 
        });
    } catch (error) {
        logger.error(`Fetch History Error for user ${req.session.firstName}: ${error.message}`);
        next(error);
    }
});

router.post('/assistant/delete_message', isAuthenticated, async (req, res, next) => {
    try {
        const userId = req.session.firstName;
        const user = await getUser(userId);

        if (!user?.thread_id) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const result = await deleteLastMessagePair(user.thread_id);

        if (result.error) {
            logger.warn(`Delete Message Error for user ${userId}: ${result.error}`);
            res.status(400).json({ error: result.error });
        } else {
            logger.info(`Deleted messages for user ${userId}`);
            res.json({ success: true });
        }
    } catch (error) {
        logger.error(`Delete Message Error for user ${req.session.firstName}: ${error.message}`);
        next(error);
    }
});

router.post('/assistant/try_again', isAuthenticated, async (req, res, next) => {
    try {
        const userId = req.session.firstName;
        const user = await getUser(userId);

        if (!user?.thread_id) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const result = await deleteLastMessagePair(user.thread_id);
        if (result.error) {
            logger.warn(`Try Again Error for user ${userId}: ${result.error}`);
            return res.status(400).json({ error: result.error });
        }

        await openai.beta.threads.messages.create(user.thread_id, { role: "user", content: result.userContent });
        logger.info(`User ${userId} is trying again with message: ${result.userContent}`);

        await handleStreaming(res, user.thread_id, assistant_id_full, userId);
    } catch (error) {
        logger.error(`Try Again Error for user ${req.session.firstName}: ${error.message}`);
        next(error);
    }
});

router.post('/assistant/edit_message', isAuthenticated, async (req, res, next) => {
    try {
        const { new_message } = req.body;
        const userId = req.session.firstName;
        const user = await getUser(userId);

        if (!user?.thread_id || !new_message?.trim()) {
            return res.status(400).json({ error: "Invalid request" });
        }

        const result = await deleteLastMessagePair(user.thread_id);
        if (result.error) {
            logger.warn(`Edit Message Delete Error for user ${userId}: ${result.error}`);
            return res.status(400).json({ error: result.error });
        }

        await openai.beta.threads.messages.create(user.thread_id, { role: "user", content: new_message });
        logger.info(`User ${userId} edited message to: ${new_message}`);

        await handleStreaming(res, user.thread_id, assistant_id_full, userId);
    } catch (error) {
        logger.error(`Edit Message Error for user ${req.session.firstName}: ${error.message}`);
        next(error);
    }
});

router.post('/assistant/stop_response', isAuthenticated, (req, res, next) => {
    const { assistant_id, thread_id } = req.body;

    if (!assistant_id || !thread_id) {
        return res.status(400).json({ error: "Assistant ID and Thread ID are required." });
    }
    logger.info(`Stop signal received for assistant ${assistant_id} and thread ${thread_id}.`);
    res.status(200).json({ status: "Stopping assistant response." });
});

router.post('/assistant/settings', isAuthenticated, async (req, res, next) => {
    try {
        const { class_schedules, all_assignments } = req.body;

        if (!class_schedules || !all_assignments) {
            return res.status(400).json({ error: 'All settings fields are required.' });
        }

        const userId = req.session.firstName;

        await updateUserSettings(userId, class_schedules, all_assignments);
        logger.info(`Settings updated for user: ${userId}`);

        res.status(200).json({ message: 'Settings updated successfully!' });
    } catch (error) {
        logger.error(`Update Settings Error for user ${req.session.firstName}: ${error.message}`);
        next(error);
    }
});

router.get('/assistant/settings', isAuthenticated, async (req, res, next) => {
    try {
        const userId = req.session.firstName;
        const user = await getUser(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        res.status(200).json({
            class_schedules: user.class_schedules || '',
            all_assignments: user.all_assignments || '',
        });
    } catch (error) {
        logger.error(`Fetch Settings Error for user ${req.session.firstName}: ${error.message}`);
        next(error);
    }
});

router.get('/schedule_tutorial', (req, res) =>{
    res.sendFile(path.join(__dirname, '..', 'public', 'html', 'schedule_tutorial.html'));
});

router.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.sendFile(path.join(__dirname, '..', 'public', 'robots.txt'));
});

router.get('sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.sendFile(path.join(__dirname, '..', 'public', 'sitemap.xml'));
});

router.get('/health', async (req, res) => {
    try {
        // Check Redis
        await redisClient.ping();

        // Check SQLite
        db.get('SELECT 1', (err) => {
            if (err) {
                logger.error('Database health check failed:', err);
                return res.status(500).json({ status: 'Database connection failed' });
            }

            // All checks passed
            res.status(200).json({ status: 'OK' });
        });
    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(500).json({ status: 'Redis connection failed' });
    }
});


module.exports = router;
