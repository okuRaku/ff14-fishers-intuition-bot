const { EmbedBuilder } = require('discord.js');
const DATA = require('./data.js')
const WEATHER_BLOCK_MS = 8 * 175 * 1000;

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
                .setFooter({ text: "  P   ▲   C   ▶︎   F   ▶︎   F  ▶︎  F ; Previous, Current, Future, Future, Future. ▶︎ ▲ is a regular transition, ▷ △ is a rare one."})
            const finalString = regions.map(region => {
                prediction = futureWeatherForRegion(region, cachedRegionWeatherRates)
                return `### ${region}\n${Object.keys(prediction).map(zone => {
                    return `${prediction[zone]
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
            embed.setDescription(finalString)
        } catch (e) {
            console.log(e)
            embed.setColor('#1fa1e0')
                .setTitle('Something went amiss predicting weather for: ' + parentRegion)
                .setThumbnail('https://xivapi.com/i/001000/001135.png')
                .setFooter({text: 'If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417'})
        }
        return embed
    },
};
