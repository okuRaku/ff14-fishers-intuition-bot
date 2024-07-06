const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { EmbedBuilder } = require('discord.js');
const DATA = require('./data.js')
const wait = require('util').promisify(setTimeout);
const i18n = require('i18n')

i18n.configure({
    locales: ['en', 'ja', 'fr', 'de'],
    directory: __dirname + '/locales',
    register: global
});

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

const buildIntuitionString = (predators, locale, cachedTCItems) => {
    return predators.map(p => `${p.amount}x ${cachedTCItems[p.id][locale]}`).join('\n')
}

const buildSpotString = (spotId, locale, cachedSpotData) => {
    return `${cachedSpotData[spotId][locale]} (${cachedSpotData[spotId].x}, ${cachedSpotData[spotId].y})`
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
        `https://gubal.ffxivteamcraft.com/graphql`,
        {
            method: 'POST',
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                operationName: 'FishersIntuitionFishDetails',
                query: `query FishersIntuitionFishDetails($itemId: Int!) {
                            allagan_reports(where:{itemId: {_eq: $itemId}}){
                                data, source
                            }
                        }`,
                variables: { itemId: fishId }
            })
        }
    ).then(response => response.json());

    if (allaganReports.data.allagan_reports.length > 0) {
        const reports = allaganReports.data.allagan_reports.filter(r => (r.source == "FISHING" || r.source == "SPEARFISHING"))

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
                "Item.Name@ja",
                "Item.Name@fr",
                "Item.Name@de",
                "Text",
                "Text@ja",
                "Text@fr",
                "Text@de",
                "Item.Icon",
                "GatheringItemLevel.GatheringItemLevel",
                "GatheringItemLevel.Stars",
                "FishingRecordType.Addon.Text",
                "FishingRecordType.Addon.Text@ja",
                "FishingRecordType.Addon.Text@fr",
                "FishingRecordType.Addon.Text@de",
                "GatheringSubCategory.FolkloreBook",
                "GatheringSubCategory.FolkloreBook@ja",
                "GatheringSubCategory.FolkloreBook@fr",
                "GatheringSubCategory.FolkloreBook@de",
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
                name: {
                    en: fish.fields.Item.fields.Name,
                    ja: fish.fields.Item.fields?.['Name@ja'],
                    fr: fish.fields.Item.fields?.['Name@fr'],
                    de: fish.fields.Item.fields?.['Name@de']
                },
                level: fish.fields.GatheringItemLevel.fields.GatheringItemLevel,
                ilevel: fish.fields.GatheringItemLevel.value,
                stars: fish.fields.GatheringItemLevel.fields.Stars,
                waters: {
                    en: fish.fields.FishingRecordType.fields.Addon.fields.Text,
                    ja: fish.fields.FishingRecordType.fields.Addon.fields?.['Text@ja'],
                    fr: fish.fields.FishingRecordType.fields.Addon.fields?.['Text@fr'],
                    de: fish.fields.FishingRecordType.fields.Addon.fields?.['Text@de']
                },
                icon: fish.fields.Item.fields.Icon.path_hr1,
                collectable: fish.fields.Item.fields.IsCollectable,
                printIcon: (fish.fields.Item.fields.Icon.path.replace(/(\/\d)2(\d+\/\d)2(\d+)/, '$17$27$3')),
                guide: {
                    en: fish.fields.Text == ''? 'TBD' : fish.fields.Text,
                    ja: fish.fields.Text == ''? '不明' : fish.fields?.['Text@ja'],
                    fr: fish.fields.Text == ''? 'TBD' : fish.fields?.['Text@fr'],
                    de: fish.fields.Text == ''? 'TBD' : fish.fields?.['Text@de']
                },
                folklore: {
                    en: fish.fields.GatheringSubCategory.fields?.FolkloreBook,
                    ja: fish.fields.GatheringSubCategory.fields?.['FolkloreBook@ja'],
                    fr: fish.fields.GatheringSubCategory.fields?.['FolkloreBook@fr'],
                    de: fish.fields.GatheringSubCategory.fields?.['FolkloreBook@de']
                }
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
    buildEmbed: async (fishId, locale, cachedFishGuides, cachedTCItems, cachedLodinnStats, cachedSpotData) => {
        const embed = new EmbedBuilder()
        try {
            i18n.setLocale(locale)
            const fishGuide = cachedFishGuides[fishId]
            const lodinns = cachedLodinnStats[cachedTCItems[fishId][locale]]
            embed.setColor('#1fa1e0')
                .setTitle(`${fishGuide.name[locale]}${fishGuide.collectable ? ' <:LogbookCollectableIcon:1254432749448593448>' : ''}`)
                .setDescription(fishGuide.guide[locale])
                .setURL(fishGuide.oceanFishingTime?'https://ffxiv.oceanfishing.boats/index.html':`https://ffxivteamcraft.com/db/en/item/${fishId}`)
                .setThumbnail(`https://beta.xivapi.com/api/1/asset/${fishGuide.printIcon}?format=png`)
                // .setThumbnail(`https://beta.xivapi.com/api/1/asset/${fishGuide.icon}?format=png`)
                .setFooter({ text: 'Data from XIVAPI, Teamcraft\'s Allagan Reports, and Lodinn\'s stats.', iconURL: 'https://cdn.discordapp.com/emojis/851649094799982643.webp' })
            embed.setAuthor(
                {
                    name: `${fishGuide.level} (${fishGuide.ilevel}) ${'★'.repeat(fishGuide.stars)} ${fishGuide.waters[locale]}${fishGuide.folklore[locale] ? ' // ' + fishGuide.folklore[locale] : ''}`,
                    iconURL: `https://beta.xivapi.com/api/1/asset/${fishGuide.icon}?format=png`
                })

            embed.addFields({ name: i18n.__('Preferred Bait'), value: `${(fishGuide.bait in cachedFishGuides) ? '<:Mooch:851647291122122772>' : '<:Bait:851646932442939394>'} ${cachedTCItems[fishGuide.bait][locale]}`, inline: true })
            embed.addFields({ name: i18n.__('Tug & Hookset'), value: `${fishGuide.tug} ${fishGuide.hookset}`, inline: true })
            embed.addFields({ name: i18n.__('Prime Locations'), value: `${fishGuide.spots.map(s => buildSpotString(s, locale, cachedSpotData)).join('\n')}`, inline: true })
            embed.addFields({ name: i18n.__('Weather'), value: fishGuide.weathers?.length > 0? buildWeatherString(fishGuide.weathersFrom, fishGuide.weathers):'N/A', inline: true })
            if (('spawn' in fishGuide && fishGuide.spawn != undefined) && ('duration' in fishGuide && fishGuide.duration != undefined) ) {
                const times = timeConverter(fishGuide.spawn, fishGuide.duration)
                embed.addFields({ name: i18n.__('Time'), value: `${times.start}–${times.end}`, inline: true })
            } else if (fishGuide.oceanFishingTime) {
                embed.addFields({ name: i18n.__('Time'), value: DATA.OCEAN_TIME[fishGuide.oceanFishingTime], inline: true })
            } else {
                embed.addFields({ name: i18n.__('Time'), value: i18n.__('Always Up'), inline: true })
            }
            embed.addFields({ name: fishGuide.minGathering? i18n.__('Min Gathering'):' ', value: fishGuide.minGathering?`${fishGuide.minGathering} [<:teamcraft:629747659917492224>](https://ffxivteamcraft.com/allagan-reports/${fishId})`: ' ', inline: true })
            lodinns && embed.addFields({ name: i18n.__('Est. slip rate'), value: `${(lodinns.slip_rate * 100).toFixed(1)}% [<:BigPixelFisher:1254442517248872528>](https://lodinn.github.io/stats?fish=${encodeURIComponent(fishGuide.name.en)})`, inline: true })
            lodinns && embed.addFields({ name: i18n.__('Est. bite rate'), value: `${(lodinns.bite_rate * 100).toFixed(1)}%`, inline: true })
            lodinns && embed.addFields({ name: i18n.__('Bite times'), value: `${lodinns.min_bitetime}–${lodinns.max_bitetime}s`, inline: true })
            
            if(fishGuide.predators?.length > 0) {
                embed.addFields({ name: `<:FishersIntuition:851656821794013208> ${i18n.__('Intuition Requirements')}:`, value: buildIntuitionString(fishGuide.predators, locale, cachedTCItems), inline: false })
                fishGuide.predators.forEach(predator => {
                    const predatorStrings = []
                    const predatorGuide = cachedFishGuides[predator.id]
                    predatorGuide.weathers?.length > 0 && predatorStrings.push(`**${i18n.__('Weather')}:** ${buildWeatherString(predatorGuide.weathersFrom, predatorGuide.weathers)}`)
                    if (predatorGuide.spawn && predatorGuide.duration) {
                        const times = timeConverter(predatorGuide.spawn, predatorGuide.duration)
                        predatorStrings.push(`**${i18n.__('Time')}:** ${times.start}–${times.end}`)
                    } else if (predatorGuide.oceanFishingTime) {
                        predatorStrings.push(`**${i18n.__('Time')}:** ${DATA.OCEAN_TIME[fishGuide.oceanFishingTime]}`)
                    }
                    predatorStrings.push(`**${i18n.__('Bait')}:** ${predatorGuide.bait in cachedFishGuides? '<:Mooch:851647291122122772>':'<:Bait:851646932442939394>'} ${cachedTCItems[predatorGuide.bait][locale]}`)
                    predatorStrings.push(`**${i18n.__('Tug')}:** ${predatorGuide.tug}`)
                    predatorStrings.push(`**${i18n.__('Hookset')}:** ${predatorGuide.hookset}`)

                    embed.addFields({ name: `<:FishersIntuition:851656821794013208> ${predatorGuide.name[locale]} (${predator.amount})`, value: predatorStrings.join('\n'), inline: true })
                })
            }

            if(fishGuide.bait in cachedFishGuides) {
                let bait = fishGuide.bait // to mark bait as we traverse the mooch sequence 
                const moochSequence = [] // to keep ids of fish in reverse order of mooch
                while(bait in cachedFishGuides) {
                    moochSequence.unshift(bait)
                    bait = cachedFishGuides[bait].bait
                }
                embed.addFields({ name: `<:Mooch:851647291122122772> ${i18n.__('Mooch Details')}: `, value: moochSequence.map(id => cachedTCItems[id][locale]).join(' → '), inline: false })
                let mooch = 0;
                while(mooch = moochSequence.shift()) {
                    const moochStrings = []
                    const moochGuide = cachedFishGuides[mooch]
                    moochGuide.weathers?.length > 0 && moochStrings.push(`**${i18n.__('Weather')}:** ${buildWeatherString(moochGuide.weathersFrom, moochGuide.weathers)}`)
                    if (moochGuide.spawn && moochGuide.duration) {
                        const times = timeConverter(moochGuide.spawn, moochGuide.duration)
                        moochStrings.push(`**${i18n.__('Time')}:** ${times.start}–${times.end}`)
                    } else if (moochGuide.oceanFishingTime) {
                        moochStrings.push(`**${i18n.__('Time')}:** ${DATA.OCEAN_TIME[moochGuide.oceanFishingTime]}`)
                    }
                    moochStrings.push(`**${i18n.__('Bait')}:** ${cachedTCItems[moochGuide.bait][locale]}`)
                    moochStrings.push(`**${i18n.__('Tug')}:** ${moochGuide.tug}`)
                    moochStrings.push(`**${i18n.__('Hookset')}:** ${moochGuide.hookset}`)

                    embed.addFields({ name: `<:Mooch:851647291122122772> ${moochGuide.name[locale]}`, value: moochStrings.join('\n'), inline: true })
                }
            }
            
            fishGuide.fruityVideo && embed.addFields({ name: 'How to Catch <:MoraStare2:1252086468562911343>', value: fishGuide.fruityVideo, inline: false })
            
        } catch (e) {
            console.log(e)
            embed.setColor('#1fa1e0')
                .setTitle(i18n.__('Incomplete data for') + ': ' + cachedFishGuides[fishId].name[locale])
                .setThumbnail('https://xivapi.com/i/001000/001135.png')
                .setFooter({ text: i18n.__('ErrorMentionText') })
                .setURL('https://ffxivteamcraft.com/search?type=Item&query=' + encodeURIComponent(cachedFishGuides[fishId].name[locale]))
        }
        return embed
    }
};
