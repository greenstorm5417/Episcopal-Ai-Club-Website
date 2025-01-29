const axios = require("axios");
const ical = require("ical");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const logger = require('../config/logger');

function fixWebcal(url) {
    if (typeof url !== 'string') {
        throw new Error("URL must be a string.");
    }
    let fixedUrl = url.replace(/^webcal:\/\//i, "https://");
    const queryIndex = fixedUrl.indexOf("?");
    if (queryIndex !== -1) {
        fixedUrl = fixedUrl.substring(0, queryIndex);
    }
    return fixedUrl;
}

function formatTime(date) {
    const options = { hour: "numeric", minute: "numeric", hour12: true };
    return new Intl.DateTimeFormat("en-US", options).format(date);
}

function modifyDescription(description) {
    if (!description) return "No description provided";
    let modified = description.replace(/^Block:/, "Period:");
    const firstSemicolonIndex = modified.indexOf(";");
    if (firstSemicolonIndex !== -1) {
        modified = modified.substring(0, firstSemicolonIndex).trim();
    }
    return modified;
}

async function extractScheduleFromUrl(icsUrl, startDate, endDate) {
    try {
        logger.info("Fetching ICS file...");
        const response = await axios.get(icsUrl);
        const calendarData = response.data;

        logger.info("Parsing ICS data...");
        const parsedData = ical.parseICS(calendarData);
        const schedule = {};

        for (const eventId in parsedData) {
            const event = parsedData[eventId];
            if (event.type !== "VEVENT") continue;

            const eventDate = event.start.toISOString().split("T")[0];
            const eventDateObj = new Date(eventDate);
            eventDateObj.setHours(0, 0, 0, 0);

            if (eventDateObj < startDate || eventDateObj > endDate) {
                continue;
            }

            const startTime = formatTime(event.start);
            const endTime = formatTime(event.end);

            const eventDetails = {
                start_time: startTime,
                end_time: endTime,
                summary: event.summary || "No summary provided",
                location: event.location || "No location provided",
                description: modifyDescription(event.description),
                raw_start: event.start,
            };

            if (!schedule[eventDate]) {
                schedule[eventDate] = [];
            }
            schedule[eventDate].push(eventDetails);
        }

        for (const date in schedule) {
            schedule[date].sort((a, b) => a.raw_start - b.raw_start);
        }

        for (const date in schedule) {
            schedule[date] = schedule[date].map(eventDetails => {
                delete eventDetails.raw_start;
                return eventDetails;
            });
        }

        return schedule;
    } catch (error) {
        logger.error("Error fetching or parsing the ICS file:", { message: error.message, stack: error.stack });
        throw error;
    }
}

function generateHash(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

async function getSchedule(url, startDate = null, endDate = null) {
    if (!url) {
        throw new Error("URL is required.");
    }

    const fixedUrl = fixWebcal(url);
    const cacheDir = path.join(__dirname, 'cache');

    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    const urlHash = generateHash(fixedUrl);
    const cacheFilePath = path.join(cacheDir, `${urlHash}.json`);

    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;

    let schedule = null;

    if (fs.existsSync(cacheFilePath)) {
        const cacheContent = fs.readFileSync(cacheFilePath, 'utf-8');
        const cacheData = JSON.parse(cacheContent);
        const cacheTime = new Date(cacheData.timestamp);

        if ((now - cacheTime) < oneDayMs) {
            schedule = cacheData.schedule;
            logger.info("Using cached data.");
        }
    }

    if (!schedule) {
        const allStartDate = new Date(0);
        const allEndDate = new Date(8640000000000000);
        schedule = await extractScheduleFromUrl(fixedUrl, allStartDate, allEndDate);
        const cacheData = {
            timestamp: now.toISOString(),
            schedule: schedule
        };
        fs.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 4));
        logger.info("Fetched and cached new data.");
    }

    const today = new Date();
    const defaultStartDate = new Date(today);
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);
    const defaultEndDate = new Date(today);
    defaultEndDate.setDate(defaultEndDate.getDate() + 30);

    let start, end;

    if (startDate) {
        start = (startDate instanceof Date) ? startDate : new Date(startDate);
        if (isNaN(start)) {
            throw new Error("Invalid startDate format. Use YYYY-MM-DD or a valid Date object.");
        }
    } else {
        start = defaultStartDate;
    }

    if (endDate) {
        end = (endDate instanceof Date) ? endDate : new Date(endDate);
        if (isNaN(end)) {
            throw new Error("Invalid endDate format. Use YYYY-MM-DD or a valid Date object.");
        }
    } else {
        end = defaultEndDate;
    }

    const filteredSchedule = {};

    for (const date in schedule) {
        const scheduleDate = new Date(date);
        scheduleDate.setHours(0, 0, 0, 0);

        if (scheduleDate >= start && scheduleDate <= end) {
            filteredSchedule[date] = schedule[date];
        }
    }

    return filteredSchedule;
}

module.exports = {
    getSchedule
};
