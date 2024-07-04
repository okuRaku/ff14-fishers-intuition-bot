const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { EmbedBuilder } = require('discord.js');
const DATA = require('./data.js')
const wait = require('util').promisify(setTimeout);

const timeConverter = (spawn, duration) => {
    const d1 = new Date(0, 0)
    d1.setMinutes(spawn * 60)
    const d2 = new Date(d1.getTime() + duration * 60 * 60 * 1000)
    return {
        start: d1.toTimeString().slice(0, 5),
        end: d2.toTimeString().slice(0, 5)
    }
}

// const spotLookupById = (id) => {
//     const spots = Object.values(DATA.SPOTS)
//         .flatMap(region => Object.values(region).flatMap(area => area));
//     const spot = spots.find(spot => spot[1] === id);
//     return spot ? spot[0] : null;
// }

const buildWeatherString = (weathersFrom, weathers) => {
    weathersFromEmotified = weathersFrom?.map(w => DATA.WEATHER[w]).join(' ')
    weathersEmotified = weathers.map(w => DATA.WEATHER[w]).join(' ')
    return weathersFromEmotified ?
        `${weathersFromEmotified} → ${weathersEmotified}` : weathersEmotified
}

const buildIntuitionString = (predators, cachedTCItems) => {
    return predators.map(p => `${p.amount}x ${cachedTCItems[p.id].en}`).join('\n')
}

const buildSpotString = (spotId, cachedSpotData) => {
    return `${cachedSpotData[spotId].en} (${cachedSpotData[spotId].x}, ${cachedSpotData[spotId].y})`
}

const populateAllaganReportsData = async (fishId, fishGuide, targetSpot) => {
    const hooksetEmotes = {
        1: "<:PowerfulHookset:851647463903199262>",
        2: "<:PrecisionHookset:851647463840546816>"
    }
    const tugEmotes = {
        1: "<:ferocious_bite:1079108257689370634>",
        0: "<:strong_bite:1079108258792476793>",
        2: "<:weak_bite:1079108260738633798>"
    }

    const allaganReports = await fetch(
        `https://gubal.ffxivteamcraft.com/api/rest/allagan_reports/${fishId}`
    ).then(response => response.json());

    if (allaganReports.allagan_reports.length > 0) {
        const reports = allaganReports.allagan_reports
        if (typeof reports[0].data === 'string') {
            reports.map(r => r.data = JSON.parse(r.data))
        }
        if(!targetSpot) targetSpot = reports[0].data.spot
        const targetReport = reports.find(r => targetSpot == r.data.spot)

        const spots = reports.map(r => {
            if (r.itemId == targetReport.itemId) return r.data.spot
        })
        fishGuide[fishId] = {
            tug: tugEmotes[targetReport.data.tug],
            hookset: hooksetEmotes[targetReport.data.hookset],
            bait: targetReport.data.bait,
            spots: spots,
            spawn: targetReport.data.spawn,
            duration: targetReport.data.duration,
            weathersFrom: targetReport.data.weathersFrom,
            weathers: targetReport.data.weathers,
            predators: targetReport.data.predators,
            fruityVideo: targetReport.data.fruityVideo,
            minGathering: targetReport.data.minGathering,
            oceanFishingTime: targetReport.data.oceanFishingTime,
            ...fishGuide[fishId]
        }

        if(targetReport.data.predators?.length > 0) {
            for (const predator of targetReport.data.predators) {
                await populateAllaganReportsData(predator.id, fishGuide, targetSpot)
            }
        }

        if(targetReport.data.bait in fishGuide) {
            await populateAllaganReportsData(targetReport.data.bait, fishGuide, targetSpot)
        }
    }

    return fishGuide

}

const populateXivApiData = async () => {
    console.log(`Starting Fish Guide population...`)
    let morePages = true
    const fishGuide = {}
    for (let i = 0; (i < 4 && morePages); i++) {
        const allFishParameters = await fetch(`https://beta.xivapi.com/api/1/sheet/FishParameter?` + new URLSearchParams({
            fields: [
                "Item.Name",
                "Text",
                "Item.Icon",
                "GatheringItemLevel.GatheringItemLevel",
                "GatheringItemLevel.Stars",
                "FishingRecordType.Addon.Text",
                "GatheringSubCategory.FolkloreBook",
                "Item.IsCollectable"
            ].join(','),
            limit: 500,
            after: Math.max(0, (i * 500) - 1),
            schema: "exdschema@7.0"

        })).then(response => response.json());
        if (allFishParameters.code === 404) break;
        if (allFishParameters.rows.length < 500) morePages = false;

        allFishParameters.rows.reduce((acc, fish) => {
            acc[fish.fields.Item.value] = {
                name: fish.fields.Item.fields.Name,
                level: fish.fields.GatheringItemLevel.fields.GatheringItemLevel,
                ilevel: fish.fields.GatheringItemLevel.value,
                stars: fish.fields.GatheringItemLevel.fields.Stars,
                waters: fish.fields.FishingRecordType.fields.Addon.fields.Text,
                icon: fish.fields.Item.fields.Icon.path_hr1,
                collectable: fish.fields.Item.fields.IsCollectable,
                printIcon: (fish.fields.Item.fields.Icon.path.replace(/(\/\d)2(\d+\/\d)2(\d+)/, '$17$27$3')),
                guide: fish.fields.Text == ''? 'TBD' : fish.fields.Text,
                folklore: fish.fields.GatheringSubCategory.fields?.FolkloreBook,
            }
            return acc
        }, fishGuide)

        wait(1000)
    }
    console.log(`Populated Fish Guide with ${Object.keys(fishGuide).length} entries.`)
    return fishGuide
}


module.exports = {
    populateXivApiData: populateXivApiData,
    populateAllaganReportsData: populateAllaganReportsData,
    buildEmbed: async (fishId, cachedFishGuides, cachedTCItems, cachedLodinnStats, cachedSpotData) => {
        const embed = new EmbedBuilder()
        try {
            const fishGuide = cachedFishGuides[fishId]
            const lodinns = cachedLodinnStats[cachedTCItems[fishId].en]
            embed.setColor('#1fa1e0')
                .setTitle(`${fishGuide.name}${fishGuide.collectable ? ' <:LogbookCollectableIcon:1254432749448593448>' : ''}`)
                .setDescription(fishGuide.guide)
                .setURL(fishGuide.oceanFishingTime?'https://ffxiv.oceanfishing.boats/index.html':`https://ffxivteamcraft.com/db/en/item/${fishId}`)
                .setThumbnail(`https://beta.xivapi.com/api/1/asset/${fishGuide.printIcon}?format=png`)
                // .setThumbnail(`https://beta.xivapi.com/api/1/asset/${fishGuide.icon}?format=png`)
                .setFooter({ text: 'Data from XIVAPI, Teamcraft\'s Allagan Reports, and Lodinn\'s stats.', iconURL: 'https://cdn.discordapp.com/emojis/851649094799982643.webp' })
            embed.setAuthor(
                {
                    name: `${fishGuide.level} (${fishGuide.ilevel}) ${'★'.repeat(fishGuide.stars)} ${fishGuide.waters}${fishGuide.folklore ? ' // ' + fishGuide.folklore : ''}`,
                    iconURL: `https://beta.xivapi.com/api/1/asset/${fishGuide.icon}?format=png`
                })

            embed.addFields({ name: 'Preferred Bait', value: `${(fishGuide.bait in cachedFishGuides) ? '<:Mooch:851647291122122772>' : '<:Bait:851646932442939394>'} ${cachedTCItems[fishGuide.bait].en}`, inline: true })
            embed.addFields({ name: 'Tug & Hookset', value: `${fishGuide.tug} ${fishGuide.hookset}`, inline: true })
            embed.addFields({ name: 'Prime Locations', value: `${fishGuide.spots.map(s => buildSpotString(s, cachedSpotData)).join('\n')}`, inline: true })
            embed.addFields({ name: 'Weather', value: fishGuide.weathers?.length > 0? buildWeatherString(fishGuide.weathersFrom, fishGuide.weathers):'Any', inline: true })
            if (('spawn' in fishGuide && fishGuide.spawn != undefined) && ('duration' in fishGuide && fishGuide.duration != undefined) ) {
                const times = timeConverter(fishGuide.spawn, fishGuide.duration)
                embed.addFields({ name: 'Time', value: `${times.start}–${times.end}`, inline: true })
            } else if (fishGuide.oceanFishingTime) {
                embed.addFields({ name: 'Time', value: DATA.OCEAN_TIME[fishGuide.oceanFishingTime], inline: true })
            } else {
                embed.addFields({ name: 'Time', value: `Always up`, inline: true })
            }
            embed.addFields({ name: fishGuide.minGathering? 'Min Gathering':' ', value: fishGuide.minGathering?`${fishGuide.minGathering} [<:teamcraft:629747659917492224>](https://ffxivteamcraft.com/allagan-reports/${fishId})`: ' ', inline: true })
            lodinns && embed.addFields({ name: 'Est. slip rate', value: `${(lodinns.slip_rate * 100).toFixed(1)}% [<:BigPixelFisher:1254442517248872528>](https://lodinn.github.io/stats?fish=${encodeURIComponent(fishGuide.name)})`, inline: true })
            lodinns && embed.addFields({ name: 'Est. bite rate', value: `${(lodinns.bite_rate * 100).toFixed(1)}%`, inline: true })
            lodinns && embed.addFields({ name: 'Bite times', value: `${lodinns.min_bitetime}–${lodinns.max_bitetime}s`, inline: true })
            
            if(fishGuide.predators?.length > 0) {
                embed.addFields({ name: '<:FishersIntuition:851656821794013208> Intuition Requirements:', value: buildIntuitionString(fishGuide.predators, cachedTCItems), inline: false })
                fishGuide.predators.forEach(predator => {
                    const predatorStrings = []
                    const predatorGuide = cachedFishGuides[predator.id]
                    predatorGuide.weathers?.length > 0 && predatorStrings.push(`**Weather:** ${buildWeatherString(predatorGuide.weathersFrom, predatorGuide.weathers)}`)
                    if (predatorGuide.spawn && predatorGuide.duration) {
                        const times = timeConverter(predatorGuide.spawn, predatorGuide.duration)
                        predatorStrings.push(`**Time:** ${times.start}–${times.end}`)
                    } else if (predatorGuide.oceanFishingTime) {
                        predatorStrings.push(`**Time:** ${DATA.OCEAN_TIME[fishGuide.oceanFishingTime]}`)
                    }
                    predatorStrings.push(`**Bait:** ${predatorGuide.bait in cachedFishGuides? '<:Mooch:851647291122122772>':'<:Bait:851646932442939394>'} ${cachedTCItems[predatorGuide.bait].en}`)
                    predatorStrings.push(`**Tug:** ${predatorGuide.tug}`)
                    predatorStrings.push(`**Hookset:** ${predatorGuide.hookset}`)

                    embed.addFields({ name: `<:FishersIntuition:851656821794013208> ${predatorGuide.name} (${predator.amount})`, value: predatorStrings.join('\n'), inline: true })
                })
            }

            if(fishGuide.bait in cachedFishGuides) {
                let bait = fishGuide.bait // to mark bait as we traverse the mooch sequence 
                const moochSequence = [] // to keep ids of fish in reverse order of mooch
                while(bait in cachedFishGuides) {
                    moochSequence.unshift(bait)
                    bait = cachedFishGuides[bait].bait
                }
                embed.addFields({ name: '<:Mooch:851647291122122772> Mooch details: ', value: moochSequence.map(id => cachedTCItems[id].en).join(' → '), inline: false })
                let mooch = 0;
                while(mooch = moochSequence.shift()) {
                    const moochStrings = []
                    const moochGuide = cachedFishGuides[mooch]
                    moochGuide.weathers?.length > 0 && moochStrings.push(`**Weather:** ${buildWeatherString(moochGuide.weathersFrom, moochGuide.weathers)}`)
                    if (moochGuide.spawn && moochGuide.duration) {
                        const times = timeConverter(moochGuide.spawn, moochGuide.duration)
                        moochStrings.push(`**Time:** ${times.start}–${times.end}`)
                    } else if (moochGuide.oceanFishingTime) {
                        moochStrings.push(`**Time:** ${DATA.OCEAN_TIME[moochGuide.oceanFishingTime]}`)
                    }
                    moochStrings.push(`**Bait:** ${cachedTCItems[moochGuide.bait].en}`)
                    moochStrings.push(`**Tug:** ${moochGuide.tug}`)
                    moochStrings.push(`**Hookset:** ${moochGuide.hookset}`)

                    embed.addFields({ name: `<:Mooch:851647291122122772> ${moochGuide.name}`, value: moochStrings.join('\n'), inline: true })
                }
            }
            
            fishGuide.fruityVideo && embed.addFields({ name: 'How to Catch <:MoraStare2:1252086468562911343>', value: fishGuide.fruityVideo, inline: false })
            
        } catch (e) {
            console.log(e)
            embed.setColor('#1fa1e0')
                .setTitle('Incomplete data for: ' + cachedFishGuides[fishId].name)
                .setThumbnail('https://xivapi.com/i/001000/001135.png')
                .setFooter({ text: 'If you believe this may be in error, please @mention okuRaku#1417' })
                .setURL('https://ffxivteamcraft.com/search?type=Item&query=' + encodeURIComponent(cachedFishGuides[fishId].name))
        }
        return embed
    }
};