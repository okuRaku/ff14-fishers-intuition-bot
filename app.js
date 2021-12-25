const { Client, Intents, MessageEmbed, MessageActionRow, MessageSelectMenu, MessageButton, MessageAttachment } = require('discord.js');
const Canvas = require('canvas');

// const { token } = require('./config.json');
const token = process.env.TOKEN

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const DATA = require('./data.js')

// helper function for determining icon url
// via: https://xivapi.com/docs/Icons
const guessIconUrl = (icon_id, hr=false) => {
    // ensure string
    icon_id = icon_id.toString()
    // first we need to add padding to the icon_id
    if (icon_id.length < 6) {
        icon_id = icon_id.padStart(6, '0')
    }
    // Now we can build the folder from the padded icon_id
    folder_id = icon_id[0] + icon_id[1] + icon_id[2] + '000'
    return 'https://xivapi.com/i/' + folder_id + '/' + icon_id + (hr?'_hr1':'') + '.png'
}

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

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });
client.once('ready', () => {
    console.log('Ready!');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'cancel') {
        await interaction.deferUpdate();
        await interaction.editReply({ content: '`Cancelled.`', components: [] });
    }
})

client.on('interactionCreate', async interaction => {
    if (!interaction.isSelectMenu()) return;
    // When a select menu interaction is created, we make sure the values parameter (all that gets passed)
    // carries along any data we need from prior menus.   This is done by having values be a comma separated list
    const [selectValue, plotType] = interaction.values[0].split(',')    

    if (interaction.customId === 'region' && !Array.isArray(DATA.SPOTS[selectValue])) {
        const row = new MessageActionRow()
            .addComponents(
                new MessageSelectMenu()
                    .setCustomId('zone')
                    .setPlaceholder('Select Zone')
                    // ZONES
                    .addOptions(Object.keys(DATA.SPOTS[selectValue]).map(key => { 
                        return {
                            label: prettifySelectionKey(key),
                            value: [key, plotType].join(',')
                        }})),
            )

        const buttonRow = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId('cancel')
                    .setLabel('Cancel')
                    .setStyle('SECONDARY'),
            )

        await interaction.update({ content: 'Chart bite times for a fishing spot.  Please make a selection:', ephemeral: true, components: [row, buttonRow] });
    }

    // prepare options array to look ahead for singular choice zones
    let options = []
    if(interaction.customId === 'zone') {
        const regionKey = Object.keys(DATA.SPOTS).find(searchKey => selectValue in DATA.SPOTS[searchKey] )
        options = DATA.SPOTS[regionKey][selectValue]
    } else if ( Array.isArray(DATA.SPOTS[selectValue]) ){
        options = DATA.SPOTS[selectValue]
    }

    // Skip this if there's only one fishing spot in that zone
    if (options.length != 1 
        && (interaction.customId === 'zone' || Array.isArray(DATA.SPOTS[selectValue]))) {
        
        const row = new MessageActionRow()
            .addComponents(
                new MessageSelectMenu()
                    .setCustomId('spot')
                    .setPlaceholder('Select Fishing Spot')
                    // SPOTS
                    .addOptions(options.map(spot => { 
                        return {
                            label: spot[0],
                            value: [(spot[0] + ';' + spot[1].toString()),plotType].join(',')
                        }})),

            )

        const buttonRow = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId('cancel')
                    .setLabel('Cancel')
                    .setStyle('SECONDARY'),
            )

        await interaction.update({ content: 'Chart bite times for a fishing spot.  Please make a selection:', ephemeral: true, components: [row, buttonRow] });
    }

    // Final step
    if (interaction.customId === 'spot' || options.length === 1) {
        await interaction.deferUpdate();
        let loadingCounter = 0
        const loadingInterval = setInterval(async () => {
            await interaction.editReply({ content: '`Processing'+ '.'.repeat(loadingCounter) + '`', components: [] });
            loadingCounter = (loadingCounter + 1) % 4
        },500)

        const interactionValue = (
            (interaction.customId === 'zone' && options.length === 1)?
            options[0]:
            selectValue.split(';'))
        const embed = new MessageEmbed()
        let attachment
        try {
            const bitetimes = await fetch('https://ff14-fishing-plotter.herokuapp.com/bitetimes?'  + new URLSearchParams({
                spotId: interactionValue[1],
                plotType: plotType || 'box',
            })).then(response => response.json());

            clearInterval(loadingInterval);

            // via discordjs documentation
            const canvas = Canvas.createCanvas(614,351);
            const context = canvas.getContext('2d');
            const background = await Canvas.loadImage(bitetimes.plot);

            // This uses the canvas dimensions to stretch the image onto the entire canvas
            context.drawImage(background, 0, 0, canvas.width, canvas.height);

            // Use the helpful Attachment class structure to process the file for you
            attachment = new MessageAttachment(canvas.toBuffer(), 'buffered-image.png');

            embed.setColor('#1fa1e0')
                .setAuthor('Bite times for fishing spot: ' + interactionValue[0],'', 'https://ffxivteamcraft.com/db/en/fishing-spot/' + interactionValue[1])
                .setDescription('`/bitetimes` executed by <@!' + interaction.member + '>')
                .setImage('attachment://buffered-image.png')
                .setFooter('Based on FFXIV Teamcraft by Miu#1568. Run time: ' + bitetimes.runtime)
        } catch {
            clearInterval(loadingInterval)
            embed.setColor('#1fa1e0')
                .setAuthor('Error retrieving bite times for: ' + interactionValue[0])
                .setThumbnail('https://xivapi.com/i/001000/001135.png')
                .setFooter('If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417')
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
        const row = new MessageActionRow()
            .addComponents(
                new MessageSelectMenu()
                    .setCustomId('region')
                    .setPlaceholder('Select Region')
                    // REGION
                    .addOptions(Object.keys(DATA.SPOTS).map(key => { 
                        return {
                            label: prettifySelectionKey(key),  
                            value: [key, plotType].join(',')}
                        })),
            )
        const buttonRow = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId('cancel')
                    .setLabel('Cancel')
                    .setStyle('SECONDARY'),
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


        const embed = new MessageEmbed()
        try {
            const windows = await fetch('https://ff14-fish-planner.herokuapp.com/windows?format=discord&fish=' + encodeURIComponent(fish)).then(response => response.json());
            embed.setColor('#1fa1e0')
                .setThumbnail(guessIconUrl(windows.icon, true))
                .setFooter('Based on FFX|V Fish Tracker App by Carbuncle Plushy. Run time: ' + windows.runtime.substring(0, 5) + 'ms')
            if(null != windows.folklore) {
                embed.setAuthor(
                        'Upcoming windows for: ' + toTitleCase(fish),
                        'https://xivapi.com/i/026000/026164.png',
                        'https://ffxivteamcraft.com/search?type=Item&query=' + encodeURIComponent(windows.folklore))
                     .setDescription(windows.folklore)
            } else {
                embed.setAuthor(
                    'Upcoming windows for: ' + toTitleCase(fish))
            }
            const availabilities = windows.availability.slice(0, numWindows)
            let windowStrings
            if (compactMode) {
                windowStrings = availabilities.map(a => (a.start - Date.now() < 8.64e+7 ? `<t:${(a.start / 1000).toFixed(0)}:R>` : `<t:${(a.start / 1000).toFixed(0)}:d> <t:${(a.start / 1000).toFixed(0)}:t>`) + `${displayDuration ? ' (' + a.duration + ')' : ''}${displayDowntime ? '; ' + a.downtime : ''}`)
                embed.addField('Next Window Start' + (displayDuration ? ' (Duration)' : '') + (displayDowntime ? '; Downtime' : ''), windowStrings.join('\n'), true)
            } else {
                windowStrings = availabilities.map(a => `<t:${(a.start / 1000).toFixed(0)}:${(a.start - Date.now() < 8.64e+7) ? 'R' : 'D'}>`)  //shows relative time under 24h
                embed.addField('Next Start', windowStrings.join('\n'), true)
                if (displayDuration) {
                    embed.addField('Duration', availabilities.map(a => `${a.duration}`).join('\n'), true)
                }
                if (displayDowntime) {
                    embed.addField('Downtime', availabilities.map(a => `${a.downtime || '\u200b'}`).join('\n'), true)
                }

            }
        } catch {
            embed.setColor('#1fa1e0')
                .setTitle('Found no windows for: ' + fish)
                .setThumbnail('https://xivapi.com/i/001000/001135.png')
                .setFooter('If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417')
                .setDescription('Please use exact spelling, with spaces and punctuation.  Click the above title link to search Teamcraft for your fish.')
                .setURL('https://ffxivteamcraft.com/search?type=Item&query=' + encodeURIComponent(fish))
        }

        interaction.editReply({
            embeds: [embed]
        });
    }

    if (commandName === 'timeline') {
        await interaction.reply({ content: '`Starting...`', ephemeral: true});

        let loadingCounter = 0
        const loadingInterval = setInterval(async () => {
            await interaction.editReply({ content: '`Processing'+ '.'.repeat(loadingCounter) + '`', components: [] });
            loadingCounter = (loadingCounter + 1) % 4
        },500)

        const charName = interaction.options.getString('character_name');
        const charServer = interaction.options.getString('server');
        const achievement = interaction.options.getString('achievement');

        const embed = new MessageEmbed()
        let attachment
        try {
            const lodestone = await fetch('https://xivapi.com/character/search?'  + new URLSearchParams({
                name: charName,
                server: charServer,
            })).then(response => response.json());
            const timeline = await fetch('https://ff14-fishing-plotter.herokuapp.com/timeline?'  + new URLSearchParams({
                charId: lodestone.Results[0].ID, // just take the first one, hopefully right
                achievement: achievement,
            })).then(response => response.json());

            clearInterval(loadingInterval);
            // via discordjs documentation
            const canvas = Canvas.createCanvas(614,351);
            const context = canvas.getContext('2d');
            const background = await Canvas.loadImage(timeline.plot);

            // This uses the canvas dimensions to stretch the image onto the entire canvas
            context.drawImage(background, 0, 0, canvas.width, canvas.height);

            // Use the helpful Attachment class structure to process the file for you
            attachment = new MessageAttachment(canvas.toBuffer(), 'buffered-image.png');

            embed.setColor('#1fa1e0')
                //.setTitle(achievement)
                .setAuthor(
                    achievement,
                    timeline.img,
                    'https://na.finalfantasyxiv.com/lodestone/character/'+ lodestone.Results[0].ID + '/achievement/category/34/#anchor_achievement')
                .setDescription('`/timeline` executed by <@!' + interaction.member + '> for **'+ toTitleCase(charName) + ' ('+ toTitleCase(charServer) +')**')
                .setImage('attachment://buffered-image.png')
                //.setURL('https://na.finalfantasyxiv.com/lodestone/character/'+ lodestone.Results[0].ID + '/achievement/category/34/#anchor_achievement')
                .setThumbnail(lodestone.Results[0].Avatar)
                .setFooter('Based on public Lodestone data.  Run time: ' + timeline.runtime)

        } catch(e) {
            console.log(e)
            clearInterval(loadingInterval);
            await interaction.editReply({ content: 'Encountered an error running `/timeline`.  Please double check that the character has the achievement.  If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417', components: [] });
        }

        await interaction.followUp({ components: [], embeds: [embed], files: (typeof attachment === "undefined" ? [] : [attachment]) });
        await interaction.editReply({ content: '`...Finished!`', components: [] });
    }
});

client.login(token);