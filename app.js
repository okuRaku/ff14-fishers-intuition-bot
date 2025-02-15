const { Client, Events, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const Canvas = require('canvas');
const Fuse = require('fuse.js')

// const { token, channelIds, alertRoles } = require('./config.json');
const [token, channelIds, alertRoles] = [process.env.TOKEN, JSON.parse(process.env.ALERT_CHANNEL_IDS), JSON.parse(process.env.ALERT_ROLES)]

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const DATA = require('./data.js')

const wait = require('util').promisify(setTimeout);

const windows = require('./windows');
const rareAlerts = require('./rare-alerts');
const fishGuide = require('./fish-guide');

const prettifySelectionKey = (keyString) => {
    return keyString.replace(/(^\w{1})|(\s+\w{1})|(_+\w{1})/g, letter => letter.toUpperCase()).replaceAll('_', ' ')
}

const toTitleCase = (phrase) => {
    return phrase
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

const getFishId = (fishString, guide) => {
    const fuse = new Fuse(Object.keys(guide).map(key => {
        return {
            name: guide[key].name.en,
            nameja: guide[key].name.ja,
            namefr: guide[key].name.fr,
            namede: guide[key].name.de,
            id: key
        }
    }), {keys:['name', 'nameja', 'namefr', 'namede']})
    return fuse.search(fishString)[0].item.id
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once(Events.ClientReady, c => {
    console.log('Ready!');
    });

// Following is a background process, designed to check periodically whether a small set of the rarest fish are coming up soon, and message a configured channel if so
// start processes for these three rarest fish for now
channelIds.forEach(chan => {
    rareAlerts.rareFishBackgroundChecker('The Ruby Dragon', chan, alertRoles[chan]["ruby"], client)
    rareAlerts.rareFishBackgroundChecker('Cinder Surprise', chan, alertRoles[chan]["cinder"], client)
    rareAlerts.rareFishBackgroundChecker('Ealad Skaan', chan, alertRoles[chan]["ealad"], client)
})

// Also at startup populate the fish guide data, TC item names, Lodinn stats
let cachedFishGuides = {}
let cachedTCItems = {}
let cachedTCSpearfishingData = {}
let cachedTCCollectibleRewards = {}
let cachedTCReverseReduction = {}
let cachedLodinnStats = {}
let cachedSpotData = {}
fishGuide.populateXivApiData().then(populated => cachedFishGuides = populated)
fetch('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/items.json')
    .then(response => response.json().then(json => {
        cachedTCItems = json
        console.log(`Cached ${Object.keys(json).length} items from Teamcraft`)
    }))

fetch('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/spear-fishing-log.json')
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
                    if(spearfish.itemId in cachedTCSpearfishingData) {
                        cachedTCSpearfishingData[spearfish.itemId].push(f)
                    } else {
                        cachedTCSpearfishingData[spearfish.itemId] = [f]
                    }
                })
                console.log(`Cached ${Object.keys(cachedTCSpearfishingData).length} spearfish from Teamcraft`)
            }))
    }))
fetch('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/collectables.json')
    .then(response => response.json().then(json => {
        cachedTCCollectibleRewards = json
        console.log(`Cached ${Object.keys(cachedTCCollectibleRewards).length} collectible rewards`)
    }))
fetch('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/reverse-reduction.json')
    .then(response => response.json().then(json => {
        cachedTCReverseReduction = json
        console.log(`Cached ${Object.keys(cachedTCReverseReduction).length} reverse reduction data`)
    }))
    
fetch('https://lodinn.github.io/assets/big_fish_stats_latest.json')
    .then(response => response.json().then(json => {
        cachedLodinnStats = json
        console.log(`Cached ${Object.keys(json).length} items from Lodinn's stats`)
    }))

fetch('https://beta.xivapi.com/api/1/sheet/FishingSpot?limit=500&schema=exdschema@7.0&fields=PlaceName.Name@ja,PlaceName.Name@en,PlaceName.Name@fr,PlaceName.Name@de')
    .then(response => response.json().then(xivSpotJson => {
        fetch('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/fishing-spots.json')
            .then(response => response.json().then(json => {
                json.map(spot => {
                    const xivSpot = xivSpotJson.rows.find(s => s.row_id === spot.id)
                    let x = undefined
                    let y = undefined
                    if(spot.coords) {
                        x = spot.coords.x
                        y = spot.coords.y
                        x = +x.toFixed(1)
                        y = +y.toFixed(1)
                    }
                    cachedSpotData[spot.id] = {
                        x: x,
                        y: y,
                        en: xivSpot.fields.PlaceName.fields["Name"],
                        ja: xivSpot.fields.PlaceName.fields["Name@ja"],
                        fr: xivSpot.fields.PlaceName.fields["Name@fr"],
                        de: xivSpot.fields.PlaceName.fields["Name@de"]
                    }
                })
                console.log(`Cached ${Object.keys(cachedSpotData).length} fishing spots`)
            }))
    }))


client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'cancel') {
        await interaction.deferUpdate();
        await interaction.editReply({ content: '`Cancelled.`', components: [] });
    }
})

client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    // When a select menu interaction is created, we make sure the values parameter (all that gets passed)
    // carries along any data we need from prior menus.   This is done by having values be a comma separated list
    const [selectValue, plotType] = interaction.values[0].split(',')

    if (interaction.customId === 'region' && !Array.isArray(DATA.SPOTS[selectValue])) {
        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('zone')
                    .setPlaceholder('Select Zone')
                    // ZONES
                    .addOptions(Object.keys(DATA.SPOTS[selectValue]).map(key => {
                        return {
                            label: prettifySelectionKey(key),
                            value: [key, plotType].join(',')
                        }
                    })),
            )

        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary),
            )

        await interaction.update({ content: 'Chart bite times for a fishing spot.  Please make a selection:', ephemeral: true, components: [row, buttonRow] });
    }

    // prepare options array to look ahead for singular choice zones
    let options = []
    if (interaction.customId === 'zone') {
        const regionKey = Object.keys(DATA.SPOTS).find(searchKey => selectValue in DATA.SPOTS[searchKey])
        options = DATA.SPOTS[regionKey][selectValue]
    } else if (Array.isArray(DATA.SPOTS[selectValue])) {
        options = DATA.SPOTS[selectValue]
    }

    // Skip this if there's only one fishing spot in that zone
    if (options.length != 1
        && (interaction.customId === 'zone' || Array.isArray(DATA.SPOTS[selectValue]))) {

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('spot')
                    .setPlaceholder('Select Fishing Spot')
                    // SPOTS
                    .addOptions(options.map(spot => {
                        return {
                            label: spot[0],
                            value: [(spot[0] + ';' + spot[1].toString()), plotType].join(',')
                        }
                    })),

            )

        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary),
            )

        await interaction.update({ content: 'Chart bite times for a fishing spot.  Please make a selection:', ephemeral: true, components: [row, buttonRow] });
    }

    // Final step
    if (interaction.customId === 'spot' || options.length === 1) {
        await interaction.deferUpdate();
        let loadingCounter = 0
        const loadingInterval = setInterval(async () => {
            await interaction.editReply({ content: '`Processing' + '.'.repeat(loadingCounter) + '`', components: [] });
            loadingCounter = (loadingCounter + 1) % 4
        }, 500)

        const interactionValue = (
            (interaction.customId === 'zone' && options.length === 1) ?
                options[0] :
                selectValue.split(';'))
        const embed = new EmbedBuilder()
        let attachment
        try {
            const bitetimes = await fetch('https://ff14-fish-plotter.fly.dev/bitetimes?' + new URLSearchParams({
                spotId: interactionValue[1],
                plotType: plotType || 'box',
            })).then(response => response.json());

            clearInterval(loadingInterval);

            // via discordjs documentation
            const canvas = Canvas.createCanvas(614, 351);
            const context = canvas.getContext('2d');
            const background = await Canvas.loadImage(bitetimes.plot);

            // This uses the canvas dimensions to stretch the image onto the entire canvas
            context.drawImage(background, 0, 0, canvas.width, canvas.height);

            // Use the helpful Attachment class structure to process the file for you
            attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'buffered-image.png' });

            embed.setColor('#1fa1e0')
                .setAuthor({ name: 'Bite times for fishing spot: ' + interactionValue[0], url: 'https://ffxivteamcraft.com/db/en/fishing-spot/' + interactionValue[1] })
                .setDescription('`/bitetimes` executed by <@!' + interaction.member + '>')
                .setImage('attachment://buffered-image.png')
                .setFooter({ text: 'Based on FFXIV Teamcraft by Miu#1568. Run time: ' + bitetimes.runtime })
        } catch {
            clearInterval(loadingInterval)
            embed.setColor('#1fa1e0')
                .setAuthor({ name: 'Error retrieving bite times for: ' + interactionValue[0] })
                .setThumbnail('https://xivapi.com/i/001000/001135.png')
                .setFooter({ text: 'If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417' })
        }

        await interaction.followUp({ components: [], embeds: [embed], files: (typeof attachment === "undefined" ? [] : [attachment]) });
        await interaction.editReply({ content: '`...Finished!`', components: [] });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'bitetimes') {
        const plotType = interaction.options.getString('plot_type');
        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('region')
                    .setPlaceholder('Select Region')
                    // REGION
                    .addOptions(Object.keys(DATA.SPOTS).map(key => {
                        return {
                            label: prettifySelectionKey(key),
                            value: [key, plotType].join(',')
                        }
                    })),
            )
        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary),
            )

        await interaction.reply({ content: 'Chart bite times for a fishing spot.  Please make a selection:', ephemeral: true, components: [row, buttonRow] });
    }

    if (commandName === 'windows') {
        await interaction.deferReply();
        const fish = interaction.options.getString('fish');
        const numWindows = Math.min(10, interaction.options.getInteger('number_of_windows') || 5)
        const displayDowntime = interaction.options.getBoolean('display_downtime') === null ? true : interaction.options.getBoolean('display_downtime')
        const compactMode = interaction.options.getBoolean('compact_mode') === null ? true : interaction.options.getBoolean('compact_mode')
        const displayDuration = interaction.options.getBoolean('display_duration') === null ? false : interaction.options.getBoolean('display_duration')


        const embed = await windows.buildEmbed(fish, numWindows, displayDowntime, compactMode, displayDuration)

        interaction.editReply({
            embeds: [embed]
        });
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
            attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'buffered-image2.png' });

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
        const locale = interaction.options.getString('language')? interaction.options.getString('language') :  (() => {
            switch(interaction.locale) {
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

            if(interaction.options.getBoolean('fruity_guide')) {
                await interaction.editReply({
                    content: cachedFishGuides[fishId].fruityVideo,
                });
            } else {
                const embed = await fishGuide.buildEmbed(
                    fishId, locale, 
                    cachedFishGuides, cachedTCItems, cachedLodinnStats, 
                    cachedSpotData, cachedTCSpearfishingData, 
                    cachedTCCollectibleRewards, cachedTCReverseReduction)
                if(interaction.options.getBoolean('spoiler')) {
                    embed.setAuthor({
                        name:`${embed.data.author.name}`.replace(/\).*/,')'),
                        iconURL:embed.data.author.icon_url
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
            
        } catch(e) {
            console.log(e)
            await interaction.editReply({ content: 'Encountered an error running `/fishguide`.  Please double check that the fish has data on Teamcraft.  If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417', components: [] });
        }
    }
});

client.login(token);