const { Client, Events, GatewayIntentBits, EmbedBuilder, SectionBuilder, ActionRowBuilder, MediaGalleryBuilder, StringSelectMenuBuilder, ContainerBuilder, StringSelectMenuOptionBuilder, TextDisplayBuilder, MessageFlags, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const Canvas = require('@napi-rs/canvas');
const Fuse = require('fuse.js')

// const { token, channelIds, alertRoles } = require('./config.json');
const [token, channelIds, alertRoles] = [process.env.TOKEN, JSON.parse(process.env.ALERT_CHANNEL_IDS), JSON.parse(process.env.ALERT_ROLES)]

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const wait = require('util').promisify(setTimeout);

const windows = require('./windows');
const weather = require('./weather');
const { getFruityGuideCandidates } = require('./guidehelper')
const rareAlerts = require('./rare-alerts');
const fishGuide = require('./fish-guide');
const biteRates = require('./biterates');

const toTitleCase = (phrase) => {
    return phrase
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};



const getFishId = (fishString, guide) => {
    if (/^\d+$/.test(fishString)) {
        return fishString
    }
    const dictionary = Object.keys(guide).map(key => {
        return {
            name: guide[key].name.en,
            nameja: guide[key].name.ja,
            namefr: guide[key].name.fr,
            namede: guide[key].name.de,
            id: key
        }
    })
    let fuse = new Fuse(dictionary, {
        keys: ['name', 'nameja', 'namefr', 'namede'],
    })
    return fuse.search(fishString)[0].item.id
}

const hasFruityGuide = async (fishId) => {
    await fishGuide.populateAllaganReportsData(fishId, cachedFishGuides)
    return (cachedFishGuides[fishId] && cachedFishGuides[fishId].fruityVideo)
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once(Events.ClientReady, c => {
    console.log('Ready!');
});

// Also at startup populate the fish guide data, TC item names, Lodinn stats
let cachedFishGuides = {}
let cachedTCItems = {}
let cachedTCSpearfishingData = {}
let cachedTCCollectibleRewards = {}
let cachedTCReverseReduction = {}
let cachedLodinnStats = {}
let cachedLodinnBiteRates = new Map() // maps better for caches? let's try!
let cachedWindows = new Map() // maps better for caches? let's try!
let cachedSpotData = {}
let cachedRegionWeatherRates = {}

const startupPromises = []

startupPromises.push(fishGuide.populateXivApiData().then(populated => cachedFishGuides = populated))
startupPromises.push(fetch('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/items.json')
    .then(response => response.json().then(json => {
        cachedTCItems = json
        console.log(`Cached ${Object.keys(json).length} items from Teamcraft`)
    })))

startupPromises.push(fetch('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/spear-fishing-log.json')
    .then(response => response.json().then(logJson => {
        fetch('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/places.json')
            .then(response => response.json().then(placesJson => {
                logJson.map(spearfish => {
                    const f = {
                        x: spearfish.coords.x,
                        y: spearfish.coords.y,
                        en: placesJson[spearfish.zoneId].en,
                        ja: placesJson[spearfish.zoneId].ja,
                        fr: placesJson[spearfish.zoneId].fr,
                        de: placesJson[spearfish.zoneId].de,
                    }
                    if (spearfish.itemId in cachedTCSpearfishingData) {
                        cachedTCSpearfishingData[spearfish.itemId].push(f)
                    } else {
                        cachedTCSpearfishingData[spearfish.itemId] = [f]
                    }
                })
                console.log(`Cached ${Object.keys(cachedTCSpearfishingData).length} spearfish from Teamcraft`)
            }))
    })))
startupPromises.push(fetch('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/collectables.json')
    .then(response => response.json().then(json => {
        cachedTCCollectibleRewards = json
        console.log(`Cached ${Object.keys(cachedTCCollectibleRewards).length} collectible rewards`)
    })))
startupPromises.push(fetch('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/reverse-reduction.json')
    .then(response => response.json().then(json => {
        cachedTCReverseReduction = json
        console.log(`Cached ${Object.keys(cachedTCReverseReduction).length} reverse reduction data`)
    })))

startupPromises.push(fetch('https://lodinn.github.io/assets/big_fish_stats_latest.json')
    .then(response => response.json().then(json => {
        cachedLodinnStats = json
        console.log(`Cached ${Object.keys(json).length} items from Lodinn's stats`)
    })))

startupPromises.push(fetch('https://lodinn.github.io/assets/spot_data/available_spots.json')
    .then(response => response.json().then(json => {
        cachedLodinnSpotNames = json
        console.log(`Cached ${Object.keys(json).length} spot names from Lodinn's stats`)
    })))

startupPromises.push(fetch('https://v2.xivapi.com/api/sheet/FishingSpot?limit=500&fields=PlaceName.Name@ja,PlaceName.Name@en,PlaceName.Name@fr,PlaceName.Name@de,TerritoryType.PlaceName.value')
    .then(response => response.json().then(xivSpotJson => {
        fetch('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/fishing-spots.json')
            .then(response => response.json().then(json => {
                json.map(spot => {
                    const xivSpot = xivSpotJson.rows.find(s => s.row_id === spot.id)
                    let x = undefined
                    let y = undefined
                    if (spot.coords) {
                        x = spot.coords.x
                        y = spot.coords.y
                        x = +x.toFixed(1)
                        y = +y.toFixed(1)
                    }
                    cachedSpotData[spot.id] = {
                        x: x,
                        y: y,
                        radius: spot.radius,
                        en: xivSpot.fields.PlaceName.fields["Name@en"],
                        ja: xivSpot.fields.PlaceName.fields["Name@ja"],
                        fr: xivSpot.fields.PlaceName.fields["Name@fr"],
                        de: xivSpot.fields.PlaceName.fields["Name@de"],
                        zone: xivSpot.fields.TerritoryType?.fields?.PlaceName.value
                    }
                })
                console.log(`Cached ${Object.keys(cachedSpotData).length} fishing spots`)
            }))
    })))

startupPromises.push(fetch('https://v2.xivapi.com/api/search?sheets=TerritoryType&query=WeatherRate.Rate[0]%3C100&fields=WeatherRate.Rate,WeatherRate.Weather[].Icon,PlaceName.Name@ja,PlaceName.Name@en,PlaceName.Name@fr,PlaceName.Name@de,PlaceNameRegion.Name@en,PlaceNameRegion.Name@de,PlaceNameRegion.Name@fr,PlaceNameRegion.Name@ja&limit=500')
    .then(response => response.json().then(xivTerritoryJson => {
        const seenWeatherRates = new Set();
        xivTerritoryJson["results"].map(territory => {

            const weatherRateCode = territory.fields.WeatherRate.value;

            // Skip if we've already stored this weather rate
            if (seenWeatherRates.has(weatherRateCode)) return;
            seenWeatherRates.add(weatherRateCode);

            const regionNameEn = territory.fields.PlaceNameRegion.fields["Name@en"];

            cachedRegionWeatherRates[regionNameEn] = {
                [territory.fields.PlaceName.fields["Name@en"]]: {
                    id: territory.fields.PlaceName.value,
                    placename: {
                        en: territory.fields.PlaceName.fields["Name@en"],
                        ja: territory.fields.PlaceName.fields["Name@ja"],
                        fr: territory.fields.PlaceName.fields["Name@fr"],
                        de: territory.fields.PlaceName.fields["Name@de"]
                    },
                    regionname: {
                        en: territory.fields.PlaceNameRegion.fields["Name@en"],
                        ja: territory.fields.PlaceNameRegion.fields["Name@ja"],
                        fr: territory.fields.PlaceNameRegion.fields["Name@fr"],
                        de: territory.fields.PlaceNameRegion.fields["Name@de"]
                    },
                    rates: territory.fields.WeatherRate.fields["Rate"],
                    weathers: territory.fields.WeatherRate.fields["Weather"].map(w => w.value),
                    weatherIcons: territory.fields.WeatherRate.fields["Weather"].map(w => w.fields["Icon"]["path"])
                },
                ...cachedRegionWeatherRates[regionNameEn]
            }
        })
        console.log(`Cached ${Object.keys(cachedRegionWeatherRates).length} regions weather rates`)
    })))

Promise.all(startupPromises).then(async () => {
    console.log('All caching done, ready to start background processes');
    const ruby = await windows.getWindowsForFish(24993, cachedSpotData, cachedRegionWeatherRates, cachedFishGuides)
    const egg = await windows.getWindowsForFish(33241, cachedSpotData, cachedRegionWeatherRates, cachedFishGuides)
    const ealad = await windows.getWindowsForFish(33242, cachedSpotData, cachedRegionWeatherRates, cachedFishGuides)
    // const whale = await windows.getWindowsForFish(41412, cachedSpotData, cachedRegionWeatherRates, cachedFishGuides)
    console.log('Calculated Ruby windows through: ', new Date(ruby.at(-1).endMs).toISOString())
    console.log('Calculated Cinder Surprise windows through: ', new Date(egg.at(-1).endMs).toISOString())
    console.log('Calculated Ealad Skaan windows through: ', new Date(ealad.at(-1).endMs).toISOString())
    // console.log('Calculated Sidereal Whale windows through: ', new Date(whale.at(-1).endMs).toISOString())
    // Following is a background process, designed to check periodically whether a small set of the rarest fish are coming up soon, and message a configured channel if so
    // start processes for these three rarest fish for now
    channelIds.forEach(chan => {
        rareAlerts.rareFishBackgroundChecker('The Ruby Dragon', cachedFishGuides[24993], ruby, chan, alertRoles[chan]["ruby"], client)
        rareAlerts.rareFishBackgroundChecker('Cinder Surprise', cachedFishGuides[33241], egg, chan, alertRoles[chan]["cinder"], client)
        rareAlerts.rareFishBackgroundChecker('Ealad Skaan', cachedFishGuides[33242], ealad, chan, alertRoles[chan]["ealad"], client)
        // rareAlerts.rareFishBackgroundChecker('Sidereal Whale', cachedFishGuides[41412], ealad, chan, '11111111111', client)
    })
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isAutocomplete()) return;
    const { commandName } = interaction;

    const locale = (() => {
        switch (interaction.locale) {
            case 'en-GB': return "en";
            case 'en-US': return "en";
            case 'ja': return "ja";
            case 'de': return "de";
            case 'fr': return "fr";
            default: return "en";
        }
    })();
    try {
        const keepTypingResponse = [{ name: { en: 'Keep typing...', ja: 'もう少し入力してください。', de: 'Tippen Sie noch etwas...', fr: 'Tapez encore un peu...' }[locale], value: 'nil', }]
        const noMatchesResponse = [{ name: { en: 'Not finding anything... sorry!', ja: '何も見つかりませんでした。。。', de: 'Entschuldigung, nichts gefunden...', fr: 'Désolé, rien trouvé...' }[locale], value: 'nil', }]
        let suggestions = []
        const userText = interaction.options.getFocused().toLowerCase()
        if (userText.length == 0) {
            interaction.respond(keepTypingResponse)
            return
        }

        // compile suggestions
        if (commandName === 'biterates') {
            // const preliminary = Object.entries(cachedLodinnSpotNames).filter(
            //     ([id, spotName]) => spotName.toLowerCase().includes(userText)
            // );  forego for now
            const preliminary = Object.entries(cachedSpotData).filter(
                ([id, spotNames]) => spotNames[locale].toLowerCase().includes(userText)
            )
            const dataAvailable = await Promise.all(
                preliminary.map(([id, _]) => biteRates.biterateDataAvailable(id))
            );
            suggestions = preliminary
                .filter((_, idx) => dataAvailable[idx])
                .map(([spotId, spotName]) => [spotName[locale], spotId]);
        } else if (commandName === 'bitetimes') {
            suggestions = Object.entries(cachedSpotData).filter(
                ([id, spotNames]) => spotNames[locale].toLowerCase().includes(userText)
            ).map(([id, spotNames]) => [spotNames[locale], id])
        } else if (commandName === 'weather') {
            suggestions = Object.values(cachedRegionWeatherRates)
                .flatMap(zonesMap => Object.values(zonesMap))
                .filter(zone => zone.placename[locale].toLowerCase().includes(userText.toLowerCase()))
                .map(zone => [zone.placename[locale], String(zone.id)]);
        } else {
            suggestions = Object.entries(cachedFishGuides).filter(
                ([id, guide]) => guide.name[locale].toLowerCase().includes(userText)
            ).map(([id, guide]) => [guide.name[locale], guide.name[locale]])

        }

        // respond 
        if (suggestions.length > 24) {
            interaction.respond(keepTypingResponse)
        } else if (suggestions.length == 0) {
            interaction.respond(noMatchesResponse)
        } else {
            interaction.respond(suggestions.map(([name, value]) => ({ name: name, value: value })))
        }
    } catch (e) {
        console.log(e)
        interaction.respond([])
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'cancel') {
        await interaction.deferUpdate();
        await interaction.editReply({ content: '`Cancelled.`', components: [] });
    }

    if (interaction.customId.startsWith('fruityguide-')) {
        await interaction.deferUpdate();

        const fishId = interaction.customId.slice(12);
        if (cachedFishGuides[fishId].fruityVideo) {
            await interaction.editReply({ content: 'Posting the link...', components: [] });
            await interaction.followUp({ content: cachedFishGuides[fishId].fruityVideo })
        } else {
            await interaction.editReply({
                content: 'Sorry, but something went wrong trying' +
                    ' to guess which Fruity Guide to share... would you mind' +
                    ' using `/fishguide` with the `fruity_guide` option set to `True`?' +
                    ' May also need to double check the Allagan Report has the URL.',
                components: []
            });

        }
    }
})

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isMessageContextMenuCommand()) return;
    const { commandName } = interaction;
    if (commandName === 'Fruity Guide') {
        await interaction.deferReply({ ephemeral: true });
        const sentence = interaction.targetMessage.content;
        if (sentence.length > 250) {
            interaction.editReply({
                content: 'Sorry, but this function really does not work well' +
                    ' with long message contents... would you mind' +
                    ' using `/fishguide` with the `fruity_guide` option set to `True`?'
            })
            return
        }

        try {
            const guideCandidates = (await Promise.all(
                getFruityGuideCandidates(sentence, cachedFishGuides, 7).map(async fish => ({
                    fish,
                    url: await hasFruityGuide(fish.id)
                }))
            ))
                .filter(x => x.url)
                .slice(0, 5);

            const buttonRow = new ActionRowBuilder()
            guideCandidates.forEach((c) => {
                buttonRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`fruityguide-${c.fish.id}`)
                        .setLabel(c.fish.name)
                        .setStyle(ButtonStyle.Secondary)
                )
            })

            await interaction.editReply({ content: `I think I found a guide for the message... is it one of these?`, components: [buttonRow] })
        } catch (e) {
            console.log(e)
            await interaction.editReply({
                content: 'Sorry, but something went wrong trying' +
                    ' to guess which Fruity Guide to share... would you mind' +
                    ' using `/fishguide` with the `fruity_guide` option set to `True`?' +
                    ' May also need to double check the Allagan Report has the URL.',
            });
        }
    }
});

// this block dedicated to /window + its "more windows" button handling
client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        if (interaction.commandName !== 'windows') return;
    } else if (interaction.isButton()) {
        if (!(interaction.customId.startsWith('moreWindows-') || interaction.customId.startsWith('dm_me_more_windows-'))) return;
    } else {
        return;
    }

    const locale = (() => {
        switch (interaction.locale) {
            case 'en-GB': return "en";
            case 'en-US': return "en";
            case 'ja': return "ja";
            case 'de': return "de";
            case 'fr': return "fr";
            default: return "en";
        }
    })();
    try {
        let replyViaDm = false;
        let fishId, pageNumber, pageSize, displayDowntime, displayDuration;
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('dm_me_more_windows')) {
                await interaction.reply({
                    content: "-# _Preparing DM_ 🎣",
                    ephemeral: true,
                });
                replyViaDm = true;
            } else {
                await interaction.deferUpdate();
            }
            [, fishId, pageNumber, pageSize, displayDowntime, displayDuration] = interaction.customId.split('-');
            fishId = parseInt(fishId);
            pageNumber = parseInt(pageNumber);
            pageSize = parseInt(pageSize);
            displayDowntime = displayDowntime === 'true';
            displayDuration = displayDuration === 'true';
        }
        else {
            await interaction.deferReply();
            const fish = interaction.options.getString('fish');
            fishId = getFishId(fish, cachedFishGuides, locale)
            const numWindows = Math.min(20, interaction.options.getInteger('number_of_windows') || 5);
            pageNumber = 0;
            pageSize = numWindows;
            displayDowntime = interaction.options.getBoolean('display_downtime') === null ? true : interaction.options.getBoolean('display_downtime')
            displayDuration = interaction.options.getBoolean('display_duration') === null ? false : interaction.options.getBoolean('display_duration')
        }

        if (!cachedWindows.has(fishId) || (Date.now() - cachedWindows.get(fishId).window_freshness > 600000)) {
            const freshWindows = await windows.getWindowsForFish(fishId, cachedSpotData, cachedRegionWeatherRates, cachedFishGuides)
            cachedWindows.set(fishId, { window_freshness: Date.now(), data: freshWindows })
        }
        const windowResults = cachedWindows.get(fishId).data
        const windowsToEmbed = windowResults.slice(pageNumber * pageSize, (pageNumber + 1) * pageSize)

        const container = await windows.buildEmbed(locale, windowsToEmbed, displayDowntime, displayDuration, cachedFishGuides[fishId])
        const canvas = windows.drawRarityChart(windows.calculateRarityScores(windowResults), windowsToEmbed.at(0).startMs, windowsToEmbed.at(Math.floor(windowsToEmbed.length / 2)).startMs, windowsToEmbed.at(-1).endMs)

        const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'image.png' });

        container.addMediaGalleryComponents(new MediaGalleryBuilder()
            .addItems(
                mediaGalleryItem => mediaGalleryItem
                    .setURL('attachment://image.png')))
        container.addActionRowComponents(new ActionRowBuilder()
            .addComponents([
                new ButtonBuilder()
                    .setCustomId(`moreWindows-${[fishId, pageNumber - 1, pageSize, displayDowntime, displayDuration].join('-')}`)
                    .setLabel(` Prev ${pageSize}`)
                    .setEmoji(':BigPixelFisher:1254442517248872528')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pageNumber == 0),
                new ButtonBuilder()
                    .setCustomId(`moreWindows-${[fishId, pageNumber + 1, pageSize, displayDowntime, displayDuration].join('-')}`)
                    .setLabel(` Next ${pageSize}`)
                    .setEmoji(':BigPixelFisher:1254442517248872528')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(windowResults.length < ((pageNumber + 1) * pageSize))
            ])
        )

        if (replyViaDm) {
            await interaction.user.send({
                components: [container],
                files: [attachment],
                flags: MessageFlags.IsComponentsV2
            });
        } else {
            interaction.editReply({
                components: [container],
                files: [attachment],
                flags: MessageFlags.IsComponentsV2
            });
        }



    } catch (e) {
        console.log(e)
        if (!interaction.replied) {
            await interaction.reply({
                content: "❌ Something went wrong (maybe you have DMs disabled?).",
                ephemeral: true,
            });
        } else {
            const container = new ContainerBuilder()
                .setAccentColor(0x1FA1E0).addTextDisplayComponents(
                    textDisplay => textDisplay.setContent('Encountered an issue generating Upcoming Windows for: ' + fishId))
            await interaction.editReply({
                components: [container],
                embeds: [],
                flags: MessageFlags.IsComponentsV2,
            });
        }

    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'bitetimes') {
        const plotType = interaction.options.getString('plot_type');
        const spotId = interaction.options.getString('spot');
        const locale = interaction.options.getString('language') ? interaction.options.getString('language') : (() => {
            switch (interaction.locale) {
                case 'en-GB': return "en";
                case 'en-US': return "en";
                case 'ja': return "ja";
                case 'de': return "de";
                case 'fr': return "fr";
                default: return "en";
            }
        })();

        await interaction.deferReply();

        let attachment
        try {
            const bitetimes = await fetch('https://ff14-fish-plotter.fly.dev/bitetimes?' + new URLSearchParams({
                spotId: spotId,
                plotType: plotType || 'box',
            })).then(response => response.json());

            // via discordjs documentation
            const canvas = Canvas.createCanvas(614, 351);
            const context = canvas.getContext('2d');
            const background = await Canvas.loadImage(bitetimes.plot);

            // This uses the canvas dimensions to stretch the image onto the entire canvas
            context.drawImage(background, 0, 0, canvas.width, canvas.height);

            // Use the helpful Attachment class structure to process the file for you
            attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'buffered-image.png' });

            interaction.editReply({
                content: `-# ${cachedSpotData[spotId][locale]} <:teamcraft:629747659917492224> [Data from FFXIV Teamcraft](<https://ffxivteamcraft.com/db/${locale}/fishing-spot/${spotId}>)`,
                files: [attachment]
            });
        } catch (e) {
            console.log(e)
            await interaction.deleteReply()
            await interaction.followUp({
                content: 'Encountered an error running `/bitetimes`. If possible, choose something suggested by autocomplete.. :pray: '
                    + 'If this message persists, it may be a problem with the backend.. please @mention okuRaku#1417', ephemeral: true, components: []
            });
        }
    }


    if (commandName === 'weather') {
        await interaction.deferReply();


        try {
            // Collect region and zones
            const region = interaction.options.getString('region');
            const zoneIds = Array.from({ length: 6 }, (_, i) => interaction.options.getString(`zone${i + 1}`))
                .filter(Boolean);

            // Validate: at least one input must be provided
            if (!region && zoneIds.length === 0) {
                throw Error('Neither region nor zones filled')
            }

            // Decide handling
            if (zoneIds.length > 0) {
                const canvas = await weather.renderWeatherRatesChart(zoneIds, cachedRegionWeatherRates)
                const encodedCanvas = await canvas.encode('png')
                const attachment = new AttachmentBuilder(encodedCanvas, { name: 'weatherrates.png' });
                interaction.editReply({
                    files: [attachment]
                });

            } else {
                const embed = await weather.buildEmbed(region, cachedRegionWeatherRates)
                interaction.editReply({
                    embeds: [embed]
                });
            }

        } catch (e) {
            console.log(e)
            await interaction.deleteReply()
            await interaction.followUp({
                content: 'Encountered an error running `/weather`. If possible, choose something suggested by autocomplete.. :pray: '
                    + 'If this message persists, it may be a problem with the backend.. please @mention okuRaku#1417', ephemeral: true, components: []
            });
        }
    }

    if (commandName === 'timeline') {
        await interaction.reply({ content: '`Starting...`', ephemeral: true });
        let loadingCounter = 0
        const loadingInterval = setInterval(async () => {
            await interaction.editReply({ content: '`Processing' + '.'.repeat(loadingCounter) + '`', components: [] });
            loadingCounter = (loadingCounter + 1) % 4
        }, 500)

        const charName = interaction.options.getString('character_name');
        const charServer = interaction.options.getString('server');
        const achievement = interaction.options.getString('achievement');
        const except_ranks = interaction.options.getString('except_ranks');

        const embed = new EmbedBuilder()
        let attachment
        try {
            const lodestone = await fetch('https://ff14-fish-plotter.fly.dev/character?' + new URLSearchParams({
                name: charName,
                server: charServer,
            })).then(response => response.json());
            const timeline = await fetch('https://ff14-fish-plotter.fly.dev/timeline?' + new URLSearchParams({
                charId: lodestone.charId,
                achievement: achievement,
                exceptRanks: except_ranks
            })).then(response => response.json());

            clearInterval(loadingInterval);
            // via discordjs documentation
            const canvas = Canvas.createCanvas(614, 351);
            const context = canvas.getContext('2d');
            const background = await Canvas.loadImage(timeline.plot);

            // This uses the canvas dimensions to stretch the image onto the entire canvas
            context.drawImage(background, 0, 0, canvas.width, canvas.height);

            // Use the helpful Attachment class structure to process the file for you
            attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'buffered-image2.png' });

            embed.setColor('#1fa1e0')
                //.setTitle(achievement)
                .setAuthor({
                    name: achievement,
                    iconURL: timeline.img,
                    url: 'https://na.finalfantasyxiv.com/lodestone/character/' + lodestone.charId + '/achievement/category/34/#anchor_achievement'
                })
                .setDescription('`/timeline` executed by <@!' + interaction.member + '> for **' + toTitleCase(charName) + ' (' + toTitleCase(charServer) + ')**')
                .setImage('attachment://buffered-image2.png')
                .setThumbnail(lodestone.avatar)
                //.setURL('https://na.finalfantasyxiv.com/lodestone/character/'+ lodestone.charId + '/achievement/category/34/#anchor_achievement')
                .setFooter({ text: 'Based on public Lodestone data.  Run time: ' + timeline.runtime })

            await wait(1000)
            await interaction.followUp({ components: [], embeds: [embed], files: (typeof attachment === "undefined" ? [] : [attachment]) });
            await wait(7000)
            await interaction.editReply({ content: '`...Finished!`', components: [] });

        } catch (e) {
            console.log(e)
            clearInterval(loadingInterval);
            await interaction.editReply({ content: 'Encountered an error running `/timeline`.  Please double check that the character has the achievement and has Lodestone profile public.  If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417', components: [] });
        }

    }

    if (commandName === 'fishguide') {
        await interaction.deferReply();
        const fish = interaction.options.getString('fish');
        const locale = interaction.options.getString('language') ? interaction.options.getString('language') : (() => {
            switch (interaction.locale) {
                case 'en-GB': return "en";
                case 'en-US': return "en";
                case 'ja': return "ja";
                case 'de': return "de";
                case 'fr': return "fr";
                default: return "en";
            }
        })();
        try {
            const fishId = getFishId(fish, cachedFishGuides, locale)
            await fishGuide.populateAllaganReportsData(fishId, cachedFishGuides)

            if (interaction.options.getBoolean('fruity_guide')) {
                await interaction.editReply({
                    content: cachedFishGuides[fishId].fruityVideo,
                });
            } else {
                const embed = await fishGuide.buildEmbed(
                    fishId, locale,
                    cachedFishGuides, cachedTCItems, cachedLodinnStats,
                    cachedSpotData, cachedTCSpearfishingData,
                    cachedTCCollectibleRewards, cachedTCReverseReduction)
                if (interaction.options.getBoolean('spoiler')) {
                    embed.setAuthor({
                        name: `${embed.data.author.name}`.replace(/\).*/, ')'),
                        iconURL: embed.data.author.icon_url
                    })
                    embed.setDescription(`||${embed.data.description}||`)
                    embed.setFields(embed.data.fields.map(f => {
                        return {
                            name: f.name,
                            value: `||${f.value}||`,
                            inline: f.inline
                        }
                    }))
                }
                await interaction.editReply({
                    embeds: [embed]
                });
            }

        } catch (e) {
            console.log(e)
            await interaction.editReply({ content: 'Encountered an error running `/fishguide`.  Please double check that the fish has data on Teamcraft.  If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417', components: [] });
        }
    }

    if (commandName === 'biterates') {
        await interaction.deferReply();
        const locale = interaction.options.getString('language') ? interaction.options.getString('language') : (() => {
            switch (interaction.locale) {
                case 'en-GB': return "en";
                case 'en-US': return "en";
                case 'ja': return "ja";
                case 'de': return "de";
                case 'fr': return "fr";
                default: return "en";
            }
        })();

        try {
            const spotId = interaction.options.getString('spot')

            let encodedCanvas;
            if (cachedLodinnBiteRates.has(spotId)) {
                encodedCanvas = cachedLodinnBiteRates.get(spotId)
            } else {
                const canvas = await biteRates.renderSpot(spotId, cachedFishGuides)
                encodedCanvas = await canvas.encode('png')
                cachedLodinnBiteRates.set(spotId, encodedCanvas)
            }

            const attachment = new AttachmentBuilder(encodedCanvas, { name: 'biterates.png' });
            interaction.editReply({
                content: `-# ${cachedSpotData[spotId][locale]} [<:BigPixelFisher:1254442517248872528> lodinn.github.io](<https://lodinn.github.io/>)`,
                files: [attachment]
            });


        } catch (e) {
            console.log(e)
            await interaction.deleteReply()
            await interaction.followUp({
                content: 'Encountered an error running `/biterates`. If possible, choose something suggested by autocomplete.. :pray: '
                    + 'If this message persists, it may be a problem with the backend.. please @mention okuRaku#1417', ephemeral: true, components: []
            });
        }
    }
});

client.login(token).then(async () => {
    //     await wait(5000)
    //    console.log(JSON.stringify(windows.getNextWindows({
    //    "weathers": [
    //        7
    //        ],
    //        "spawn": 0,
    //        "duration": 2,
    //        "predators": [],
    //        "minGathering": 308,
    //        "weathersFrom": [],
    //        "spot": cachedSpotData[45].zone
    //    },1,cachedRegionWeatherRates)[0], null, 2))
});