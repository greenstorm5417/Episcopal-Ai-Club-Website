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

async function extractAssignments(icsUrl, startDate, endDate) {
    try {
        const response = await axios.get(icsUrl);
        const calendarData = response.data;

        const parsedData = ical.parseICS(calendarData);
        const assignments = {};

        for (const eventId in parsedData) {
            const event = parsedData[eventId];
            if (event.type !== "VEVENT") continue;

            const assignmentDate = event.start.toISOString().split("T")[0];
            const assignmentDateObj = new Date(assignmentDate);

            if (assignmentDateObj < startDate || assignmentDateObj > endDate) {
                continue;
            }

            let startTime = null;
            let endTime = null;

            if (event.start) {
                startTime = formatTime(event.start);
            }

            if (event.end) {
                endTime = formatTime(event.end);
            }

            const assignmentDetails = {
                summary: event.summary || "No summary provided",
                description: event.description || "No description provided.",
            };

            if (startTime && endTime) {
                assignmentDetails.start_time = startTime;
                assignmentDetails.end_time = endTime;
            } else if (startTime) {
                assignmentDetails.start_time = startTime;
            }

            if (!assignments[assignmentDate]) {
                assignments[assignmentDate] = [];
            }

            assignments[assignmentDate].push(assignmentDetails);
        }

        const sortedDates = Object.keys(assignments).sort();
        const sortedAssignments = {};

        sortedDates.forEach(date => {
            sortedAssignments[date] = assignments[date];
        });

        return sortedAssignments;
    } catch (error) {
        logger.error("Error fetching or parsing the ICS file:", { message: error.message, stack: error.stack });
        throw error;
    }
}

function generateHash(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Retrieves assignments from the given URL within the specified date range.
 * Utilizes caching to minimize redundant network requests.
 * @param {string} url - The webcal URL to fetch assignments from.
 * @param {string|Date} [startDate] - The start date in YYYY-MM-DD format or a Date object.
 * @param {string|Date} [endDate] - The end date in YYYY-MM-DD format or a Date object.
 * @returns {Promise<Object>} - A promise that resolves to the assignments JSON.
 */
async function getAssignments(url, startDate = null, endDate = null) {
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

    let assignments = null;

    if (fs.existsSync(cacheFilePath)) {
        const cacheContent = fs.readFileSync(cacheFilePath, 'utf-8');
        const cacheData = JSON.parse(cacheContent);
        const cacheTime = new Date(cacheData.timestamp);

        if ((now - cacheTime) < oneDayMs) {
            assignments = cacheData.assignments;
            logger.info("Using cached data.");
        }
    }

    if (!assignments) {
        assignments = await extractAssignments(fixedUrl, new Date(0), new Date(8640000000000000));
        const cacheData = {
            timestamp: now.toISOString(),
            assignments: assignments
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

    const filteredAssignments = {};

    for (const date in assignments) {
        const assignmentDate = new Date(date);
        assignmentDate.setHours(0, 0, 0, 0);

        if (assignmentDate >= start && assignmentDate <= end) {
            filteredAssignments[date] = assignments[date];
        }
    }

    return filteredAssignments;
}

module.exports = {
    getAssignments
};
