const { createCanvas } = require("@napi-rs/canvas");
const { ContainerBuilder } = require('discord.js');
const { weatherPeriodGenerator } = require("./weather");
const fishGuide = require('./fish-guide');

// helper function for determining icon url
// via: https://xivapi.com/docs/Icons
// const guessIconUrl = (icon_id, hr = false) => {
//     // ensure string
//     icon_id = icon_id.toString()
//     // first we need to add padding to the icon_id
//     if (icon_id.length < 6) {
//         icon_id = icon_id.padStart(6, '0')
//     }
//     // Now we can build the folder from the padded icon_id
//     folder_id = icon_id[0] + icon_id[1] + icon_id[2] + '000'
//     return 'https://xivapi.com/i/' + folder_id + '/' + icon_id + (hr ? '_hr1' : '') + '.png'
// }

// below attempt to rewrite windows backend

const ALWAYS_UP_WINDOW = [{ startMs: 0, endMs: Infinity }];
const MAX_WINDOWS = 10000; // number of windows to generate per condition for recursion
const EORZEA_HOUR_MS = 175000; // integer ms per ET hour

/**
 * Convert a spawn hour in Eorzea Time to the next real-world timestamp it will occur.
 * @param {number} spawnHour - 0–24 ET hours
 * @param {number} fromMs - base timestamp (default: now)
 * @returns {number} real-world timestamp in ms
 */
function nextRealMsForEorzeaHour(spawnHour, fromMs) {
    const etNowHours = (fromMs / 1000) / 175; // ms -> s -> ET hours
    const currentEtHour = etNowHours % 24;
    let deltaEt = spawnHour - currentEtHour;
    if (deltaEt < 0) deltaEt += 24;
    const deltaMs = Math.round(deltaEt * EORZEA_HOUR_MS);
    return Math.round(fromMs + deltaMs);
}

function getStartOfCurrentWeatherPeriod(realNowMs) {
    // Convert real ms → ET hours
    const eorzeaHour = Math.floor(realNowMs / EORZEA_HOUR_MS);

    // Find the most recent weather boundary (0, 8, 16)
    const weatherHour = Math.floor(eorzeaHour / 8) * 8;

    // Convert back to real ms
    return weatherHour * EORZEA_HOUR_MS;
}

/**
 * Generate up to maxWindows time windows for a fish based on its spawn and duration.
 * @param {number} spawn - Eorzea hour spawn
 * @param {number} duration - ET hours duration
 * @param {number} maxWindows - maximum number of windows to generate
 * @param {number} fromMs - optional starting timestamp
 * @returns {Array<{startMs: number, endMs: number}>}
 */
function generateTimeWindows(spawn, duration, maxWindows = MAX_WINDOWS, fromMs) {
    if (spawn === undefined || duration === undefined) return ALWAYS_UP_WINDOW;
    const durationMs = Math.round(duration * EORZEA_HOUR_MS);
    const nextStart = nextRealMsForEorzeaHour(spawn, fromMs);         // next occurrence at/after fromMs
    const prevStart = Math.round(nextStart - EORZEA_HOUR_MS * 24);         // previous day's spawn start

    // If the previous spawn's window still covers `fromMs`, include it first (this is the currently-open window).
    const firstStart = (prevStart + durationMs > fromMs) ? prevStart : nextStart;

    const windows = [];
    for (let i = 0; i < maxWindows; i++) {
        const startMs = Math.round(firstStart + i * EORZEA_HOUR_MS * 24);
        const endMs = Math.round(startMs + durationMs);
        windows.push({ startMs, endMs });
    }
    return windows;
}
/**
 * Generate up to maxWindows future weather windows matching conditions.
 */
function generateWeatherWindows(zoneId, cachedRegionWeatherRates, weathers, weathersFrom, maxWindows = MAX_WINDOWS) {
    if (!weathers?.length && !weathersFrom?.length) return ALWAYS_UP_WINDOW;

    const windows = [];
    const currentWeatherStart = getStartOfCurrentWeatherPeriod(Date.now());
    const gen = weatherPeriodGenerator(zoneId, cachedRegionWeatherRates, currentWeatherStart);
    while (windows.length < maxWindows) {
        const period = gen.next().value;
        if (
            (!weathers || weathers.length === 0 || weathers.includes(period.weather)) &&
            (!weathersFrom || weathersFrom.length === 0 || weathersFrom.length === 0 || weathersFrom.includes(period.from))
        ) {
            windows.push({ startMs: period.startMs, endMs: period.endMs });
        }
    }

    return windows;
}

async function generateDependentWindows(fishIds, cachedSpotData, cachedRegionWeatherRates, cachedFishGuides, maxWindows = MAX_WINDOWS, fromMs) {
    if (!fishIds?.length) return ALWAYS_UP_WINDOW;

    const results = await Promise.all(
        fishIds.map(fid =>
            availabilityWindowsForFish(fid, cachedSpotData, cachedRegionWeatherRates, cachedFishGuides, maxWindows, fromMs)
        )
    );

    // // Intersect all child windows
    // let combined = results[0] || ALWAYS_UP_WINDOW;
    // for (let i = 1; i < results.length; i++) {
    //     combined = intersectWindows(combined, results[i]);
    // }

    // return combined;

    // compute rarity for each predator
    const withRarity = results.map(windows => ({
        windows,
        rarity: calculateRarityScores(windows, fromMs)
    }));

    // choose the one with lowest rarity in next 30 days
    withRarity.sort((a, b) => b.rarity[0] - a.rarity[0]);
    return withRarity[0].windows;
}


/**
 * Compute upcoming availability windows for a fish.
 * @param {number} fishId
 * @param {object} cachedSpotData
 * @param {object} cachedRegionWeatherRates
 * @param {object} cachedFishGuides
 * @param {number} maxWindows
 */
async function availabilityWindowsForFish(
    fishId,
    cachedSpotData,
    cachedRegionWeatherRates,
    cachedFishGuides,
    maxWindows = MAX_WINDOWS,
    fromMs = Date.now()
) {
    const result = await fishGuide.populateAllaganReportsData(fishId, cachedFishGuides);
    const fishData = result[fishId];

    // EARLY RETURN: missing report => assume always up
    // this probably the bait (item), so consider this the termination
    if (!fishData) return ALWAYS_UP_WINDOW;

    const spot = cachedSpotData[fishData.spot] || cachedSpotData[fishData.spots?.[0]];
    if (!spot) return ALWAYS_UP_WINDOW;

    // --- TIME WINDOWS ---
    const timeWindows = generateTimeWindows(fishData.spawn, fishData.duration, maxWindows, fromMs);
    // --- WEATHER WINDOWS ---
    const weatherWindows = generateWeatherWindows(
        spot.zone,
        cachedRegionWeatherRates,
        fishData.weathers,
        fishData.weathersFrom,
        maxWindows
    );

    // --- PREDATOR WINDOWS ---
    let predatorWindows = ALWAYS_UP_WINDOW;
    if (fishData.predators?.length) {
        predatorWindows = await generateDependentWindows(
            fishData.predators.map(p => p.id),
            cachedSpotData,
            cachedRegionWeatherRates,
            cachedFishGuides,
            maxWindows,
            fromMs
        );
    }

    // --- BAIT / MOOCH WINDOWS ---
    let baitWindows = ALWAYS_UP_WINDOW;
    if (fishData.bait !== undefined && fishData.bait !== null) {
        const baitResult = await fishGuide.populateAllaganReportsData(fishData.bait, cachedFishGuides);
        if (baitResult[fishData.bait]) {
            // Bait is another fish → recurse
            baitWindows = await generateDependentWindows(
                [fishData.bait],
                cachedSpotData,
                cachedRegionWeatherRates,
                cachedFishGuides,
                maxWindows,
                fromMs
            );
        } else {
            baitWindows = ALWAYS_UP_WINDOW; // item-bait → always available
        }
    }


    // --- INTERSECT ALL CONDITIONS ---

    let finalWindows = intersectWindows(timeWindows, weatherWindows);
    finalWindows = intersectWindows(finalWindows, predatorWindows, { restrictEnd: false });
    finalWindows = intersectWindows(finalWindows, baitWindows);
    finalWindows = mergeContiguousWindows(finalWindows);
    return finalWindows;
}

const MS_PER_REAL_DAY = 24 * 60 * 60 * 1000; // real ms
const DAYS_PER_WEEK = 7;
const NUM_WEEKS = 28;
function calculateRarityScores(windows, fromMs = Date.now()) {
    const scores = [];

    for (let w = 0; w < NUM_WEEKS; w++) {
        const start = fromMs + w * DAYS_PER_WEEK * MS_PER_REAL_DAY;
        const end = start + DAYS_PER_WEEK * MS_PER_REAL_DAY;

        const bucketWindows = windows
            .map(win => ({
                startMs: Math.max(win.startMs, start),
                endMs: Math.min(win.endMs, end)
            }))
            .filter(win => win.endMs > win.startMs)
            .sort((a, b) => a.startMs - b.startMs);

        const times = [{ startMs: start, endMs: start }, ...bucketWindows, { startMs: end, endMs: end }];
        const gaps = times.slice(0, -1).map((t, i) => times[i + 1].startMs - t.endMs).filter(g => g > 0);

        const p = 1.5;
        const gapScore = gaps.reduce((sum, g) => sum + (g / MS_PER_REAL_DAY) ** p, 0);

        scores.push(gapScore / Math.max(1, bucketWindows.length));
    }

    return scores;
}

/**
 * Intersect two window arrays.
 */
function intersectWindows(a, b, { restrictEnd = true } = {}) {
    const result = [];
    for (const wa of a) {
        for (const wb of b) {
            const start = Math.max(wa.startMs, wb.startMs);
            const end = (restrictEnd || wa.endMs == Infinity)
                ? Math.min(wa.endMs, wb.endMs)
                : wa.endMs; // preserve full window of `a`

            if (start < end) {
                result.push({ startMs: start, endMs: end });
            }
        }
    }
    return result;
}

function mergeContiguousWindows(windows) {
    if (!windows.length) return [];
    // sort by start time
    windows.sort((a, b) => a.startMs - b.startMs);
    const merged = [windows[0]];
    for (let i = 1; i < windows.length; i++) {
        const last = merged[merged.length - 1];
        const current = windows[i];

        if (current.startMs <= last.endMs) {
            // merge overlapping / touching windows
            last.endMs = Math.max(last.endMs, current.endMs);
        } else {
            merged.push(current);
        }
    }

    return merged;
}

/**
 * Internal shared chart drawing logic
 */
function drawChart(scores, highlightStartMs, highlightMedianMs, highlightEndMs, yForScore) {
    const width = 300;
    const height = 60;
    const numWeeks = 28;
    // const totalDays = scores.length; // expected 196

    const canvasWidth = width + (width / numWeeks); // extend by one week
    const canvas = createCanvas(canvasWidth, height);
    const ctx = canvas.getContext("2d");

    const halfWeekPx = (width / numWeeks) / 2;
    // const halfDayPx = (width / (numWeeks * 7)) / 2;

    // transparent background
    ctx.clearRect(0, 0, width, height);

    // background vertical lines per week (14 blocks = 28 weeks)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 14; i++) {
        const x = (i * 2 / numWeeks) * canvasWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height - 1);
        ctx.stroke();
    }

    // thin white borders
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    // left
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(2, height - 1);
    ctx.stroke();
    // right
    ctx.beginPath();
    ctx.moveTo(canvasWidth - 2, 0);
    ctx.lineTo(canvasWidth - 2, height - 1);
    ctx.stroke();
    // bottom
    ctx.beginPath();
    ctx.moveTo(2, height - 1);
    ctx.lineTo(canvasWidth - 2, height - 1);
    ctx.stroke();

    // highlight region
    if (highlightStartMs && highlightMedianMs && highlightEndMs) {
        const CHART_END_MS = MS_PER_REAL_DAY * DAYS_PER_WEEK * NUM_WEEKS;

        const startRatio = (highlightStartMs - Date.now()) / CHART_END_MS;
        const medianRatio = (highlightMedianMs - Date.now()) / CHART_END_MS;
        const endRatio = (highlightEndMs - Date.now()) / CHART_END_MS;

        const startX = startRatio * canvasWidth;
        const medianX = medianRatio * canvasWidth;
        const endX = endRatio * canvasWidth;

        ctx.fillStyle = 'rgba(31,161,224,0.4)';

        // left rect (up to just before the median)
        ctx.fillRect(startX, 1, (medianX - startX - 0.5), height - 2);

        // right rect (starting just after the median)
        ctx.fillRect(medianX + 0.5, 1, (endX - medianX - 0.5), height - 2);
    }

    const smoothed = scores.map((_, i) =>
        scores.slice(Math.max(0, i - 1), i + 1)
            .reduce((a, b) => a + b, 0) / Math.min(2, i + 1)
    );


    // draw line
    ctx.strokeStyle = '#1fa1e0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    smoothed.forEach((score, i) => {
        // const x = halfDayPx + (i / totalDays) * canvasWidth; // daily spacing
        const x = halfWeekPx + (i / numWeeks) * canvasWidth;
        const y = yForScore(score, height);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    return canvas;
}

/**
 * Draw a rarity chart for a fish’s weekly scores
 * @param {number[]} scores - length 28, rarity scores
 * @param {string} highlightStartMs
 * @param {string} highlightEndMs
 * @returns {Canvas}
 */
function drawRarityChart(scores, highlightStartMs, highlightMedianMs, highlightEndMs) {
    const zoomPixelHeight = 10;
    const zoomScoreThreshold = 0.01;
    const maxRarity = 18.5203; // Math.max(...scores, 0.01); // highest rarity

    const yForScore = (score, height) => {
        if (score <= zoomScoreThreshold) {
            return (score / zoomScoreThreshold) * zoomPixelHeight;
        }
        const remainingHeight = height - zoomPixelHeight;
        const linearScore = score - zoomScoreThreshold;
        const linearMax = maxRarity - zoomScoreThreshold;
        return zoomPixelHeight + (linearScore / linearMax) * remainingHeight;
    };

    return drawChart(scores, highlightStartMs, highlightMedianMs, highlightEndMs, yForScore);
}

/**
 * Draw a rarity chart normalized by mean ±3σ
 * @param {number[]} scores - length 28
 * @param {string} highlightStartMs
 * @param {string} highlightEndMs
 * @returns {Canvas}
 */
function drawRarityChartStd(scores, highlightStartMs, highlightMedianMs, highlightEndMs) {
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / (scores.length - 1);
    const std = Math.sqrt(variance);

    const minVal = mean - 3 * std;
    const maxVal = mean + 3 * std;

    const yForScore = (score, height) => {
        const clamped = Math.min(Math.max(score, minVal), maxVal); // keep within bounds
        return ((clamped - minVal) / (maxVal - minVal)) * height;
    };

    return drawChart(scores, highlightStartMs, highlightMedianMs, highlightEndMs, yForScore);
}

const MS_PER_REAL_MINUTE = 60 * 1000;
const MS_PER_REAL_HOUR = 60 * MS_PER_REAL_MINUTE;
function formatDuration(ms) {
    const days = Math.floor(ms / MS_PER_REAL_DAY);
    let hours = Math.round((ms % MS_PER_REAL_DAY) / MS_PER_REAL_HOUR);
    let minutes = Math.round((ms % MS_PER_REAL_HOUR) / MS_PER_REAL_MINUTE);


    if (days >= 2) {
        let result = `${days <= 3 ? '' : '**'}${days} day${days !== 1 ? 's' : ''}${days <= 3 ? '' : '**'}`;
        // Show hours if they are >= 25% of a day (i.e. >= 6)
        if (hours >= 0.25 * 24 * days) {
            result += ` ${hours} hour${hours !== 1 ? 's' : ''}`;
        }
        return result;
    } else if (days >= 1) {
        hours += days * 24
    }

    if (hours >= 2) {
        let result = `${hours} hour${hours !== 1 ? 's' : ''}`;
        // Show minutes if they are >= 25% of an hour (i.e. >= 15)
        if (minutes >= 0.25 * 60 * hours) {
            result += ` ${minutes} minute${minutes !== 1 ? 's' : ''}`;
        }
        return result;
    } else if (hours >= 1) {
        minutes += hours * 60
    }

    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
}


function addDurationDowntime(windows) {
    // assumes windows are sorted by startMs
    for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        // duration
        w.duration = formatDuration(w.endMs - w.startMs);
        // downtime until next window
        if (i === windows.length - 1) {
            w.downtime = null;
        } else {
            w.downtime = formatDuration(windows[i + 1].startMs - w.endMs);
        }
    }
    return windows;
}
// end attempt to rewrite windows backend

const getWindowsForFish = async (fishId, cachedSpotData, cachedRegionWeatherRates, cachedFishGuides) => {
    // const windows = await fetch('https://ff14-fish-windows.fly.dev/windows?format=discord&fish=' + encodeURIComponent(fish)).then(response => response.json());
    let windows = await availabilityWindowsForFish(fishId, cachedSpotData, cachedRegionWeatherRates, cachedFishGuides)
    windows = addDurationDowntime(windows)
    return windows
};

module.exports = {
    getWindowsForFish: getWindowsForFish,
    calculateRarityScores: calculateRarityScores,
    drawRarityChart: drawRarityChart,
    drawRarityChartStd: drawRarityChartStd,
    buildEmbed: async (locale, availabilities, displayDowntime, displayDuration, fishGuide, containerLabelText = 'Upcoming Windows') => {
        const container = new ContainerBuilder()
        try {
            const windowStrings = availabilities.map(a => (a.startMs - Date.now() < 3.6e+6 ? `<t:${(a.startMs / 1000).toFixed(0)}:R>` : `<t:${(a.startMs / 1000).toFixed(0)}:d> <t:${(a.startMs / 1000).toFixed(0)}:t>`) + `${displayDuration ? ' (' + a.duration + ')' : ''}${displayDowntime ? ' / ' + a.downtime : ''}`)
            container.setAccentColor(0x1FA1E0)
                .addSectionComponents(
                    section => section
                        .addTextDisplayComponents(
                            textDisplay => textDisplay
                                .setContent(`-# ${containerLabelText} <:teamcraft:629747659917492224> [Allagan Report](<https://ffxivteamcraft.com/allagan-reports/${fishGuide?.id}>)`),
                            textDisplay => textDisplay
                                .setContent(`## **${fishGuide.name[locale]}**`),
                            textDisplay => textDisplay
                                .setContent('\u200b     **Window Starts**  \u200b' + (displayDuration ? ' (Duration)' : '') + (displayDowntime ? ' / Downtime' : '') + '\n'
                                    + windowStrings.join('\n'))
                        )
                        .setThumbnailAccessory(
                            thumbnail => thumbnail
                                .setURL(`https://v2.xivapi.com/api/asset/${fishGuide.icon}?format=png`),
                        ));

        } catch (e) {
            console.log(e)
            container.addTextDisplayComponents(
                textDisplay => textDisplay.setContent('Found no windows for: ' + "fish"))
        }
        return container
    }
};