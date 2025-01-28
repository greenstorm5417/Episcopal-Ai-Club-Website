const { EventEmitter } = require('events');
const OpenAI = require('openai');
const dotenv = require('dotenv');
dotenv.config();

const db = require('../config/db');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { getAssignments } = require('../helpers/assignments');
const { getSchedule } = require('../helpers/schedule');
const logger = require('../config/logger');


function getUser(firstName) {
    logger.debug('Fetching user with first name: %s', firstName);
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE first_name = ?`, [firstName], (err, row) => {
        if (err) {
          logger.error('Error fetching user %s: %s', firstName, err.message, { stack: err.stack });
          reject(err);
        }
        else {
          if (row) {
              logger.info('User found: %s', firstName);
          } else {
              logger.warn('User not found: %s', firstName);
          }
          resolve(row || null);
        }
      });
    });
  }

  function createUser(firstName, threadId) {
    logger.debug('Creating user: %s with thread ID: %s', firstName, threadId);
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO users (first_name, thread_id) VALUES (?, ?)`,
        [firstName, threadId],
        function (err) {
          if (err) {
            logger.error('Error creating user %s: %s', firstName, err.message, { stack: err.stack });
            reject(err);
          }
          else {
            logger.info('User %s created successfully with thread ID: %s', firstName, threadId);
            resolve();
          }
        }
      );
    });
  }

  function updateUserSettings(firstName, classSchedules, allAssignments) {
    logger.debug('Updating settings for user: %s', firstName);
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE users SET class_schedules = ?, all_assignments = ? WHERE first_name = ?`,
        [classSchedules, allAssignments, firstName],
        function (err) {
          if (err) {
            logger.error('Error updating settings for user %s: %s', firstName, err.message, { stack: err.stack });
            reject(err);
          }
          else {
            logger.info('Settings updated for user: %s', firstName);
            resolve();
          }
        }
      );
    });
  }

function isAuthenticated(req, res, next) {
  if (req.session.firstName) {
      logger.debug('Authentication successful for user: %s', req.session.firstName);
      next();
  } else {
      logger.warn('Authentication failed. Redirecting to login.');
      res.redirect('/login');
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
      if (event.event === 'thread.run.requires_action') {
        await this.handleRequiresAction(event.data, event.data.id, event.data.thread_id);
      }
      if (event.event === 'thread.message.delta') {
        const text = event.data.delta.content[0]?.text?.value;
        if (text) {
          this.buffer.addMessage(text);
          let chunk;
          while ((chunk = this.buffer.getMessage()) !== null) {
            this.emit('data', chunk);
          }
        }
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  async handleRequiresAction(data, runId, threadId) {
    try {
      const toolOutputs = await Promise.all(
        data.required_action.submit_tool_outputs.tool_calls.map(async toolCall => {
          if (toolCall.function.name === 'get_current_time') {
            const date = new Date();
            const h = date.getHours();
            const m = date.getMinutes();
            const ampm = h >= 12 ? 'pm' : 'am';
            const formattedH = h % 12 || 12;
            const formattedM = m.toString().padStart(2, '0');
            return { tool_call_id: toolCall.id, output: `${formattedH}:${formattedM} ${ampm}` };
          } else if (toolCall.function.name === 'get_schedule') {
            const userSettings = await getUser(this.userId);
            const u = userSettings?.class_schedules;
            const a = userSettings?.all_assignments;
            if (!userSettings || !u || !a) {
              return {
                tool_call_id: toolCall.id,
                output: JSON.stringify({
                  error: "User settings not found or ICS URL missing. recomend that the user investagates the setting's icon next to the logout button"
                })
              };
            }
            const today = new Date();
            const in30Days = getFutureDateExcludingWeekends(today, 30);
            const assignments = await getAssignments(a, today, in30Days);
            const schedule = await getSchedule(u, today, in30Days);
            return { tool_call_id: toolCall.id, output: JSON.stringify({ assignments, schedule }) };
          } else {
            return { tool_call_id: toolCall.id, output: JSON.stringify({ error: 'Unknown tool function.' }) };
          }
        })
      );
      await this.submitToolOutputs(toolOutputs, runId, threadId);
    } catch (error) {
      console.error('Error processing required action:', error);
    }
  }

  async submitToolOutputs(toolOutputs, runId, threadId) {
    try {
      const stream = this.openai.beta.threads.runs.submitToolOutputsStream(threadId, runId, { tool_outputs: toolOutputs });
      for await (const event of stream) await this.onEvent(event);
    } catch (error) {
      console.error('Error submitting tool outputs:', error);
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
      userContent: userMessage.content[0].text.value,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage?.id
    };
  } catch (error) {
    console.error('Error in deleteLastMessagePair:', error);
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
  openai
};
