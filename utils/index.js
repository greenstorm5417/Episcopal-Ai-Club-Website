const { EventEmitter } = require('events');
const OpenAI = require('openai');
const dotenv = require('dotenv');
const axios = require('axios');
const scrapeIt = require('scrape-it');

dotenv.config();

const db = require('../config/db');
const { getAssignments } = require('../helpers/assignments');
const { getSchedule } = require('../helpers/schedule');
const logger = require('../config/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const apiKey = process.env.BRAVE_API_KEY;


async function getUser(firstName) {
    logger.debug('Fetching user with first name: %s', firstName);
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE first_name = ?', [firstName], (err, row) => {
            if (err) {
                logger.error('Error fetching user %s: %s', firstName, err.message, { stack: err.stack });
                return reject(err);
            }
            if (row) {
                logger.info('User found: %s', firstName);
            } else {
                logger.warn('User not found: %s', firstName);
            }
            resolve(row || null);
        });
    });
}

async function createUser(firstName, threadId) {
    logger.debug('Creating user: %s with thread ID: %s', firstName, threadId);
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO users (first_name, thread_id) VALUES (?, ?)',
            [firstName, threadId],
            function (err) {
                if (err) {
                    logger.error('Error creating user %s: %s', firstName, err.message, { stack: err.stack });
                    return reject(err);
                }
                logger.info('User %s created successfully with thread ID: %s', firstName, threadId);
                resolve();
            }
        );
    });
}

async function updateUserSettings(firstName, classSchedules, allAssignments) {
    logger.debug('Updating settings for user: %s', firstName);
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE users SET class_schedules = ?, all_assignments = ? WHERE first_name = ?',
            [classSchedules, allAssignments, firstName],
            function (err) {
                if (err) {
                    logger.error('Error updating settings for user %s: %s', firstName, err.message, { stack: err.stack });
                    return reject(err);
                }
                logger.info('Settings updated for user: %s', firstName);
                resolve();
            }
        );
    });
}


function isAuthenticated(req, res, next) {
    if (req.session.firstName) {
        logger.debug('Authentication successful for user: %s', req.session.firstName);
        return next();
    }
    logger.warn('Authentication failed. Redirecting to login.');
    res.redirect('/login');
}



async function searchWeb(query) {
    if (!query || typeof query !== 'string') {
        throw new Error('Invalid query parameter.');
    }

    try {
        const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
            params: { q: query },
            headers: {
                Accept: 'application/json',
                'Accept-Encoding': 'gzip',
                'X-Subscription-Token': apiKey,
            },
            timeout: 10000,
        });

        if (!response.data) {
            throw new Error('No data received from Brave Search API.');
        }

        return formatSearchResults(response.data);
    } catch (error) {
        if (error.response) {
            logger.error('API Error: %s - %s', error.response.status, error.response.statusText);
            logger.error('Response Data: %s', JSON.stringify(error.response.data));
        } else if (error.request) {
            logger.error('No response received from the API: %s', error.message);
        } else {
            logger.error('Error in setting up the request: %s', error.message);
        }
        throw error;
    }
}

function formatSearchResults(data) {
    const parseResults = (results) => {
        if (!Array.isArray(results)) return 'No results found.';

        return results
            .map(
                (result) =>
                    `Title: ${result.title || 'N/A'}
URL: ${result.url || 'N/A'}
Description: ${result.description || 'N/A'}
Source: ${(result.profile && result.profile.name) || 'N/A'}
Age: ${result.page_age || 'N/A'}`
            )
            .join('\n\n');
    };

    const queryDetails = data.query || {};
    const queryInfo = [
        `Original Query: ${queryDetails.original || 'N/A'}`,
        `Is Navigational: ${queryDetails.is_navigational || 'N/A'}`,
        `Country: ${queryDetails.country || 'N/A'}`,
        `Postal Code: ${queryDetails.postal_code || 'N/A'}`,
        `City: ${queryDetails.city || 'N/A'}`,
    ].join('\n');

    const searchResults = data.web?.results || [];
    const resultsInfo = parseResults(searchResults) || 'No results found.';

    return `=== Query Details ===\n${queryInfo}\n\n=== Search Results ===\n${resultsInfo}`;
}

async function scrapeWebsite(url) {
    try {
        const { data } = await scrapeIt(url, {
            title: 'title',
            metaDescription: {
                selector: 'meta[name="description"]',
                attr: 'content',
            },
            body: {
                selector: 'body',
                how: 'text',
            },
            articles: {
                listItem: 'article',
                data: {
                    heading: 'h1, h2, h3',
                    paragraphs: {
                        listItem: 'p',
                        data: 'text',
                    },
                    images: {
                        listItem: 'img',
                        data: {
                            src: {
                                selector: 'img',
                                attr: 'src',
                            },
                            alt: {
                                selector: 'img',
                                attr: 'alt',
                            },
                        },
                    },
                },
            },
        });

        return `Title: ${data.title || 'N/A'}
Description: ${data.metaDescription || 'N/A'}
Body: ${data.body || 'N/A'}
Articles: ${JSON.stringify(data.articles || [], null, 2)}`;
    } catch (error) {
        logger.error('Error scraping website: %s', error.message);
        throw error;
    }
}


class SmartBuffer {
  constructor(maxSize = 100) {
      this.queue = [];
      this.accumulator = [];
      this.targetChunkSize = 100;
      this.maxSize = maxSize;
  }

  shouldSendChunk(currentText) {
      if (currentText.length < this.targetChunkSize) return false;
      const breakPoints = [
          currentText.lastIndexOf('.'),
          currentText.lastIndexOf(','),
          currentText.lastIndexOf('?'),
          currentText.lastIndexOf('!')
      ].filter(p => p !== -1);
      return breakPoints.length > 0;
  }

  findBreakPoint(text) {
      const breakPoints = [];
      for (let i = 0; i < text.length; i++) {
          const char = text[i];
          if (['.', '!', '?'].includes(char) && i < text.length - 1 && /\s/.test(text[i + 1])) {
              breakPoints.push(i + 2);
          } else if (char === ',' && i < text.length - 1 && /\s/.test(text[i + 1])) {
              breakPoints.push(i + 2);
          }
      }
      if (breakPoints.length === 0) {
          const spaces = [];
          for (let i = 0; i < text.length; i++) {
              if (/\s/.test(text[i])) spaces.push(i);
          }
          const goodSpaces = spaces.filter(i => i >= this.targetChunkSize);
          if (goodSpaces.length) return goodSpaces[0] + 1;
          else if (spaces.length) return spaces[spaces.length - 1] + 1;
      }
      return breakPoints.length ? breakPoints[breakPoints.length - 1] : text.length;
  }

  processText(text) {
      if (!text) return;
      const cleanedText = text.replace(/\\n/g, '\n');
      this.accumulator.push(cleanedText);
      const accumulated = this.accumulator.join('');
      if (this.shouldSendChunk(accumulated)) {
          const breakPoint = this.findBreakPoint(accumulated);
          if (breakPoint < accumulated.length) {
              const chunk = accumulated.substring(0, breakPoint);
              const remainder = accumulated.substring(breakPoint);
              if (chunk.trim()) {
                  this.queue.push(chunk);
                  if (this.queue.length > this.maxSize) this.queue.shift();
              }
              this.accumulator = remainder ? [remainder] : [];
          } else {
              if (accumulated.trim()) {
                  this.queue.push(accumulated);
                  if (this.queue.length > this.maxSize) this.queue.shift();
              }
              this.accumulator = [];
          }
      }
  }

  addMessage(message) {
      if (!message) return;
      this.processText(message);
  }

  getMessage() {
      return this.queue.length ? this.queue.shift() : null;
  }

  flush() {
      if (!this.accumulator.length) return;
      const accumulated = this.accumulator.join('');
      if (accumulated.trim()) {
          this.queue.push(accumulated);
          if (this.queue.length > this.maxSize) this.queue.shift();
      }
      this.accumulator = [];
  }
}

class EventHandler extends EventEmitter {
    constructor(userId) {
        super();
        this.openai = openai;
        this.userId = userId;
        this.buffer = new SmartBuffer();
    }

    async onEvent(event) {
        try {
            switch (event.event) {
                case 'thread.run.requires_action':
                    await this.handleRequiresAction(event.data, event.data.id, event.data.thread_id);
                    break;
                case 'thread.message.delta':
                    {
                        const text = event.data.delta.content[0]?.text?.value;
                        if (text) {
                            this.buffer.addMessage(text);
                            let chunk;
                            while ((chunk = this.buffer.getMessage()) !== null) {
                                this.emit('data', chunk);
                            }
                        }
                    }
                    break;
                default:
                    break;
            }
        } catch (error) {
            this.emit('error', error);
        }
    }

    async handleRequiresAction(data, runId, threadId) {
        try {
            const toolOutputs = await Promise.all(
                data.required_action.submit_tool_outputs.tool_calls.map(async (toolCall) => {
                    const { name } = toolCall.function;
                    const args = JSON.parse(toolCall.function.arguments);
                    switch (name) {
                        case 'get_current_time':
                            return this.handleGetCurrentTime(toolCall);
                        case 'get_schedule':
                            return this.handleGetSchedule(toolCall);
                        case 'search_web':
                            return this.handleSearchWeb(toolCall, args);
                        case 'scrape_web':
                            return this.handleScrapeWeb(toolCall, args);
                        default:
                            return { tool_call_id: toolCall.id, output: JSON.stringify({ error: 'Unknown tool function.' }) };
                    }
                })
            );
            await this.submitToolOutputs(toolOutputs, runId, threadId);
        } catch (error) {
            logger.error('Error processing required action:', error);
        }
    }

    async handleGetCurrentTime(toolCall) {
        const date = new Date();
        const hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'pm' : 'am';
        const formattedHours = hours % 12 || 12;
        return { tool_call_id: toolCall.id, output: `${formattedHours}:${minutes} ${ampm}` };
    }

    async handleGetSchedule(toolCall) {
        const userSettings = await getUser(this.userId);
        const { class_schedules: schedules, all_assignments: assignments } = userSettings || {};

        if (!userSettings || !schedules || !assignments) {
            return {
                tool_call_id: toolCall.id,
                output: JSON.stringify({
                    error: 'User settings not found or ICS URL missing. Recommend that the user investigates the settings icon next to the logout button',
                }),
            };
        }

        const today = new Date();
        const in30Days = getFutureDateExcludingWeekends(today, 30);
        const userAssignments = await getAssignments(assignments, today, in30Days);
        const userSchedule = await getSchedule(schedules, today, in30Days);
        const currentDate = today.toLocaleDateString();

        const output = `The current date is ${currentDate}. Here is the schedule and assignments: ${JSON.stringify({
            assignments: userAssignments,
            schedule: userSchedule,
        })}`;
        return { tool_call_id: toolCall.id, output };
    }

    async handleSearchWeb(toolCall, args) {
        try {
            const searchTerm = args.search_term;
            const results = await searchWeb(searchTerm);
            logger.info('Search term: %s', searchTerm);
            return { tool_call_id: toolCall.id, output: results || JSON.stringify({ error: 'No results found.' }) };
        } catch {
            return { tool_call_id: toolCall.id, output: JSON.stringify({ error: 'Search failed.' }) };
        }
    }

    async handleScrapeWeb(toolCall, args) {
        try {
            const crawlUrl = args.crawl_url;
            const results = await scrapeWebsite(crawlUrl);
            logger.info('Scrape web arguments: %s', JSON.stringify(args));
            return { tool_call_id: toolCall.id, output: results || JSON.stringify({ error: 'No results found.' }) };
        } catch {
            return { tool_call_id: toolCall.id, output: JSON.stringify({ error: 'Scrape failed.' }) };
        }
    }

    async submitToolOutputs(toolOutputs, runId, threadId) {
        try {
            const stream = this.openai.beta.threads.runs.submitToolOutputsStream(threadId, runId, { tool_outputs: toolOutputs });
            for await (const event of stream) {
                await this.onEvent(event);
            }
        } catch (error) {
            logger.error('Error submitting tool outputs:', error);
            this.emit('error', error);
        }
    }
}

function getFutureDateExcludingWeekends(startDate, weekdaysToAdd) {
    const date = new Date(startDate);
    let addedDays = 0;
    while (addedDays < weekdaysToAdd) {
        date.setDate(date.getDate() + 1);
        const day = date.getDay();
        if (day !== 0 && day !== 6) addedDays++;
    }
    return date;
}

async function deleteLastMessagePair(threadId) {
    try {
        const messagesResponse = await openai.beta.threads.messages.list(threadId, { limit: 50, order: 'desc' });
        const messages = messagesResponse.data;

        if (!messages?.length) return { error: 'No messages' };

        let userMessage = null;
        let assistantMessage = null;

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === 'user') {
                userMessage = msg;
                if (i + 1 < messages.length && messages[i + 1].role === 'assistant') {
                    assistantMessage = messages[i + 1];
                }
                break;
            }
        }

        if (!userMessage) return { error: 'No user message' };

        await openai.beta.threads.messages.del(threadId, userMessage.id);
        if (assistantMessage) await openai.beta.threads.messages.del(threadId, assistantMessage.id);

        return {
            userContent: userMessage.content[0]?.text?.value || '',
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessage?.id,
        };
    } catch (error) {
        logger.error('Error in deleteLastMessagePair:', error);
        return { error: error.message };
    }
}


module.exports = {
    getUser,
    createUser,
    updateUserSettings,
    isAuthenticated,
    EventHandler,
    deleteLastMessagePair,
    openai,
    searchWeb,
};
