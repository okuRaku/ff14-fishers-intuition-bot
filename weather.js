const { EmbedBuilder } = require('discord.js');
const DATA = require('./data.js')
const EORZEA_MULTIPLIER = 3600 / 175;      // ≈ 20.571428571428573 ET per real hour
const WEATHER_PERIOD_MS = 8 * 175000;      // 8 ET hours = 1,400,000 ms real (23m20s)

const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const { getAverageColor } = require("fast-average-color-node");
GlobalFonts.registerFromPath('fonts/OpenSans-VariableFont_wdth,wght.ttf', 'OpenSans')

const iconCache = new Map(); // key: iconUrl, value: { buffer, avg, img }


const renderWeatherRatesChart = async (zones, cachedRegionWeatherRates) => {
    const rowHeight = 24;
    const labelWidth = 300; // space for zone names
    const padding = 10;
    const scale = 24 / 5; // 5% = 24px

    const numZones = zones.length;
    const canvasWidth = 800; // will auto-expand as needed
    const canvasHeight = numZones * (rowHeight + 2 * padding) + padding;

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d");

    ctx.font = "16px 'Open Sans'";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    let maxBarWidth = 0;

    const resolveZoneData = (id) => {
        for (const zonesMap of Object.values(cachedRegionWeatherRates)) {
            for (const zoneData of Object.values(zonesMap)) {
                if (String(zoneData.id) === String(id)) return zoneData;
            }
        }
        throw new Error(`Zone not found in cachedRegionWeatherRates by id: ${id}`);
    };


    for (let row = 0; row < numZones; row++) {
        const zoneData = resolveZoneData(zones[row]);
        const rates = zoneData.rates;
        const weathers = zoneData.weathers || [];
        const icons = zoneData.weatherIcons || [];

        const valid = rates
            .map((rate, i) => ({ rate, weather: weathers[i], icon: icons[i] }))
            .filter((e) => Number(e.rate) > 0);

        // const y = padding + row * rowHeight;
        const y = padding + row * (rowHeight + 2 * padding);

        // Label
        ctx.fillStyle = "white";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 3;
        ctx.strokeText(zoneData.placename?.en || zones[row].name, padding, y + rowHeight / 2);
        ctx.fillText(zoneData.placename?.en || zones[row].name, padding, y + rowHeight / 2);

        // Start drawing bar
        let x = labelWidth;
        for (let i = 0; i < valid.length; i++) {
            const { rate, weather, icon } = valid[i];
            const blockWidth = rate * scale;

            const iconUrl = `https://v2.xivapi.com/api/asset/${String(icon).replace(
                ".tex",
                ".tex?format=png"
            )}`;

            let cacheEntry = iconCache.get(iconUrl);
            if (!cacheEntry) {
                try {
                    const res = await fetch(iconUrl);
                    const buffer = Buffer.from(await res.arrayBuffer());
                    const avg = (weather == 1)
                        ? { hex: "#F9F8DC" }
                        : await getAverageColor(buffer, { mode: "precision" });
                    const img = await loadImage(buffer);
                    cacheEntry = { buffer, avg, img };
                    iconCache.set(iconUrl, cacheEntry);
                } catch (e) {
                    console.error("Failed to load weather icon:", iconUrl, e);
                    continue;
                }
            }

            const { avg, img } = cacheEntry;

            // Block fill
            ctx.fillStyle = avg.hex;
            ctx.fillRect(x, y, blockWidth, rowHeight);

            // Icon (centered in block)
            const iconSize = Math.min(rowHeight * 0.9, img.width, img.height);
            const cx = x + blockWidth / 2;
            const cy = y + rowHeight / 2;
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, iconSize / 2, 0, Math.PI * 2, true);
            ctx.clip();
            ctx.drawImage(img, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
            ctx.restore();

            x += blockWidth;
        }

        if (x > maxBarWidth) maxBarWidth = x;
    }

    // === Marker line for current target ===
    const currentTarget = targetForMillis(Date.now());
    const markerX = labelWidth + (currentTarget * (scale)); // scale = px per %
    ctx.fillStyle = "rgba(255, 100, 0, 0.7)"; // translucent orange-red
    ctx.fillRect(markerX, 0, 2, canvasHeight); // thin vertical line

    return canvas;
};

function getDiscordTimestamps(count = 5) {
    const baseTimestamps = getNTimestamps(count);

    // find the true weather start >= now
    const now = Date.now();
    const unixSec = Math.floor(now / 1000);
    const bell = unixSec / 175;
    const nextBell = Math.ceil(bell / 8) * 8;
    const trueNextStart = nextBell * 175 * 1000;

    // align by shifting base to match the true one
    const delta = trueNextStart - baseTimestamps[2]; // base[2] is "current"
    const adjusted = baseTimestamps.map(ms => ms + delta);

    const stamps = adjusted.map(ms => `<t:${Math.floor(ms / 1000)}:t>`);
    return [stamps.shift(), "▲", stamps.shift(), ...stamps.map(s => `▶︎${s}`)].join("");
}


const getWeather = (target, rates, weathers) => {
    let cumulative = 0;
    for (let i = 0; i < rates.length; i++) {
        cumulative += rates[i];
        if (target < cumulative) {
            return weathers[i];
        }
    }
    return null;
}

const pickWeather = (timestamp, rates, weathers) => {
    return getWeather(targetForMillis(timestamp), rates, weathers)
}

/**
 * Returns the real-world timestamp (ms) within the next weather period
 * at or after `fromMs`. Weather changes every 8 ET hours.
 */
function getNextWeatherStart(fromMs = Date.now()) {
    const eorzeaMs = fromMs * EORZEA_MULTIPLIER;
    const remainder = eorzeaMs % WEATHER_PERIOD_MS;
    const nextEorzeaMs = remainder === 0 ? eorzeaMs : eorzeaMs + (WEATHER_PERIOD_MS - remainder);
    return nextEorzeaMs / EORZEA_MULTIPLIER;
}

function findWeatherRatesForZone(cachedRegionWeatherRates, zoneId) {
    for (const regionKey of Object.keys(cachedRegionWeatherRates)) {
        const subRegions = cachedRegionWeatherRates[regionKey];
        for (const subKey of Object.keys(subRegions)) {
            const leaf = subRegions[subKey];
            if (leaf.id === zoneId) {
                return leaf;
            }
        }
    }
    return null;
}


/**
 * Generator for future weather periods in a zone.
 * Yields weather periods one at a time, indefinitely.
 */
function* weatherPeriodGenerator(zoneId, cachedRegionWeatherRates, startTimeMs) {
    const zoneData = findWeatherRatesForZone(cachedRegionWeatherRates, zoneId);
    if (!zoneData) return;

    const { rates, weathers } = zoneData;
    let timeMs = startTimeMs;
    let lastWeather = null;

    while (true) {
        const target = targetForMillis(timeMs);
        const weather = getWeather(target, rates, weathers);
        yield { startMs: timeMs, endMs: timeMs + 8 * 175000, weather, from: lastWeather };
        lastWeather = weather;
        timeMs += 8 * 175000;
    }
}


const targetForMillis = (timeMillis) => {
    // Thanks to Rogueadyn's SaintCoinach library for this calculation.
    var unixSeconds = parseInt(timeMillis / 1000);
    var bell = unixSeconds / 175;

    // Do the magic 'cause for calculations 16:00 is 0, 00:00 is 8 and 08:00 is 16
    var increment = (bell + 8 - (bell % 8)) % 24;

    var totalDays = unixSeconds / 4200;
    totalDays = (totalDays << 32) >>> 0; // Convert to uint

    var calcBase = totalDays * 100 + increment;

    var step1 = ((calcBase << 11) ^ calcBase) >>> 0;
    var step2 = ((step1 >>> 8) ^ step1) >>> 0;

    return step2 % 100;
}

const getNTimestamps = (count) => {
    return Array.from({ length: count }, (_, i) => Date.now() + (i - 1) * 8 * 175 * 1000);
};



const futureWeatherForRegion = (region, allRates) => {
    return Object.fromEntries(
        Object.entries(allRates[region]).map(([regionName, { rates, weathers }]) => {
            const totalRates = weathers.reduce((acc, weatherId, idx) => {
                acc[weatherId] = (acc[weatherId] || 0) + rates[idx];
                return acc;
            }, {});

            const timestamps = getNTimestamps(5);
            const targets = timestamps.map(ts => targetForMillis(ts));
            const weatherNums = targets.map(t => getWeather(t, rates, weathers));

            const rareFlags = weatherNums.map(w => totalRates[w] < 10);

            const highlighted = weatherNums.map((weather, idx) => {
                if (idx > 0 && rareFlags[idx] && rareFlags[idx - 1]) {
                    return -Math.abs(weather);
                }
                return weather;
            });

            return [regionName, highlighted];
        })
    );
};

module.exports = {
    buildEmbed: async (parentRegion, cachedRegionWeatherRates = undefined, authorTextPrefix = 'Upcoming windows for: ') => {
        const embed = new EmbedBuilder()
        const regions = (() => {
            switch (parentRegion) {
                case 'La Noscea': return ['La Noscea'];
                case 'The Black Shroud': return ['The Black Shroud'];
                case 'Thanalan': return ['Thanalan'];
                case 'Ishgard and Surrounding Areas': return ['Coerthas', "Abalathia's Spine", 'Dravania'];
                case 'Gyr Abania': return ['Gyr Abania'];
                case 'The Far East': return ['Hingashi', 'Othard'];
                case 'Ilsabard': return ['Ilsabard'];
                case 'Tural': return ['Yok Tural', 'Xak Tural'];
                case 'Norvrandt': return ['Norvrandt'];
                case 'Others': return ['Mor Dhona', 'The Northern Empty', 'The Sea of Stars', 'The World Unsundered', 'Unlost World'];
                default: return [parentRegion];
            }
        })();
        try {
            embed.setColor('#1fa1e0')
                .setThumbnail('https://v2.xivapi.com/api/asset/ui/icon/060000/060581_hr1.tex?format=png')
                .setFooter({ text: "▶︎ ▲ is a regular transition, ▷ △ is a rare one." })
            const finalString = regions.map(region => {
                prediction = futureWeatherForRegion(region, cachedRegionWeatherRates)
                return `### ${region}\n${Object.keys(prediction).map(zone => {
                    return `\u200b  \u200b${prediction[zone]
                        .map((w, idx) => {
                            if (idx === 0) {
                                return `${DATA.WEATHER[Math.abs(w)]}${(w < 0 ? '△' : '▲')}`
                            }
                            if (idx === 1) {
                                return DATA.WEATHER[Math.abs(w)]
                            }
                            return `${(w < 0 ? '▷' : '▶︎')}${DATA.WEATHER[Math.abs(w)]}`;
                        })
                        .join("")} ${zone}`
                }).join("\n")}`
            }).join("\n")
            embed.setDescription(finalString + '\n' + getDiscordTimestamps(5))
        } catch (e) {
            console.log(e)
            embed.setColor('#1fa1e0')
                .setTitle('Something went amiss predicting weather for: ' + parentRegion)
                .setThumbnail('https://xivapi.com/i/001000/001135.png')
                .setFooter({ text: 'If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417' })
        }
        return embed
    },
    weatherPeriodGenerator,
    WEATHER_PERIOD_MS,
    getNextWeatherStart,
    pickWeather,
    renderWeatherRatesChart
};
