const { Client, Intents, MessageEmbed, MessageActionRow, MessageSelectMenu, MessageButton, MessageAttachment } = require('discord.js');
const Canvas = require('canvas');

// const { token, channelId, alertRoleRuby, alertRoleCinder, alertRoleEalad } = require('./config.json');
const [token, channelId, alertRoleRuby, alertRoleCinder, alertRoleEalad] = [process.env.TOKEN, process.env.ALERT_CHANNEL_ID, process.env.ALERT_ROLE_RUBY, process.env.ALERT_ROLE_CINDER, process.env.ALERT_ROLE_EALAD]

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const DATA = require('./data.js')

const wait = require('util').promisify(setTimeout);
const cron = require('node-cron');

const windows = require('./windows');

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

// Following is a background process, designed to check periodically whether a small set of the rarest fish are coming up soon, and message a configured channel if so
const windowCache = {}
const updateRareWindowCache = async (fish) => {
    console.log('!!!! Updating window cache for %s at %s', fish, new Date().toUTCString())
    const rareWindowData = await windows.getWindowsForFish(fish)
    windowCache[fish] = rareWindowData
}
const rareFishBackgroundChecker = (fish, alertRole) => {
    let messagesResume = 0;
    let windowOpen = 0;
    let diffMillis = 0;

    // run once to initialize
    updateRareWindowCache(fish).then(() => {
        cron.schedule(`${fish.charCodeAt(0) % 10} */8 * * *`, async () => {
            updateRareWindowCache(fish)
        });
    
        const task = cron.schedule('15,30,45,0 * * * *', async () => {
            console.log('Checking %s at %s', fish, new Date().toUTCString())
            if(Date.now() > messagesResume) {
                windowCache[fish].availability = windowCache[fish].availability.filter(x => x.start > Date.now())
                // nextWindowIndex = windowCache[fish].availability.findIndex((x) => x.start > Date.now())
                windowOpen = windowCache[fish].availability[0].start
                diffMillis = (windowOpen - Date.now()) 
                
                // set up some intervals in millis
                const [intervalLong, intervalMedium, intervalShort, intervalImminent] = 
                [
                    1440 * 60 * 1000,  // 24 hours
                    240 * 60 * 1000,   // 4 hours
                    60 * 60 * 1000,    // 1 hour
                    30 * 60 * 1000     // 30 minutes
                ] 
                if (diffMillis <= 0) { } // do nothing, should not happen
                else if (diffMillis < intervalImminent) { 
                    console.log('within 30m, sending message for  %s at %s', fish, new Date().toUTCString()); 
                    const channel = client.channels.cache.get(channelId);
                    const embed = await windows.buildEmbed(fish, 1, true, false, false, windowCache[fish])
                    channel.send({ content: `<@${alertRole}> a rare window approaches...`,
                        embeds: [embed]
                    });
                    messagesResume = windowOpen; 
                } 
                else if (diffMillis < intervalShort) { 
                    console.log('within 1h, sending message for  %s at %s', fish, new Date().toUTCString()); 
                    const channel = client.channels.cache.get(channelId);
                    const embed = await windows.buildEmbed(fish, 1, true, false, false, windowCache[fish])
                    channel.send({ content: `<@${alertRole}> a rare window approaches...`,
                        embeds: [embed]
                    });
                    messagesResume = Date.now() + (diffMillis - intervalImminent);
                }
                else if (diffMillis < intervalMedium) { 
                    console.log('within 4h, sending message for  %s at %s', fish, new Date().toUTCString());
                    const channel = client.channels.cache.get(channelId);
                    const embed = await windows.buildEmbed(fish, 1, true, false, false, windowCache[fish])
                    channel.send({ content: `<@${alertRole}> a rare window approaches...`,
                        embeds: [embed]
                    });
                    messagesResume = Date.now() + (diffMillis - intervalShort);
                }
                else if (diffMillis < intervalLong) { 
                    console.log('within 24h, sending message for  %s at %s', fish, new Date().toUTCString()); 
                    const channel = client.channels.cache.get(channelId);
                    const embed = await windows.buildEmbed(fish, 1, true, false, false, windowCache[fish])
                    channel.send({ content: `<@${alertRole}> a rare window approaches...`,
                        embeds: [embed]
                    });
                    messagesResume = Date.now() + (diffMillis - intervalMedium);
                }
            } else {
                console.log('Task ran, but messages paused till %s for %s at %s', new Date(messagesResume).toUTCString(), fish, new Date().toUTCString());
            }
        });
    })
}

// start processes for these three rarest fish for now
rareFishBackgroundChecker('The Ruby Dragon', alertRoleRuby)
rareFishBackgroundChecker('Cinder Surprise', alertRoleCinder)
rareFishBackgroundChecker('Ealad Skaan', alertRoleEalad)

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


        const embed = await windows.buildEmbed(fish, numWindows, displayDowntime, compactMode, displayDuration)

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
            attachment = new MessageAttachment(canvas.toBuffer(), 'buffered-image2.png');

            embed.setColor('#1fa1e0')
                //.setTitle(achievement)
                .setAuthor(
                    achievement,
                    timeline.img,
                    'https://na.finalfantasyxiv.com/lodestone/character/'+ lodestone.Results[0].ID + '/achievement/category/34/#anchor_achievement')
                .setDescription('`/timeline` executed by <@!' + interaction.member + '> for **'+ toTitleCase(charName) + ' ('+ toTitleCase(charServer) +')**')
                .setImage('attachment://buffered-image2.png')
                //.setURL('https://na.finalfantasyxiv.com/lodestone/character/'+ lodestone.Results[0].ID + '/achievement/category/34/#anchor_achievement')
                //.setThumbnail(lodestone.Results[0].Avatar)
                .setFooter('Based on public Lodestone data.  Run time: ' + timeline.runtime)

        } catch(e) {
            console.log(e)
            clearInterval(loadingInterval);
            await interaction.editReply({ content: 'Encountered an error running `/timeline`.  Please double check that the character has the achievement.  If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417', components: [] });
        }
        await wait(1000)
        await interaction.followUp({ components: [], embeds: [embed], files: (typeof attachment === "undefined" ? [] : [attachment]) });
        await wait(7000)
        await interaction.editReply({ content: '`...Finished!`', components: [] });
    }
});

client.login(token);