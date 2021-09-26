const { Client, Intents, MessageEmbed } = require('discord.js');
//const { token } = require('./config.json');
const token = process.env.TOKEN

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));


// helper function for determining icon url
// via: https://xivapi.com/docs/Icons
const guessIconUrl = (icon_id) => {
    // first we need to add padding to the icon_id
    if(icon_id.length < 6) {
        icon_id = icon_id.padStart(6, '0')
    } 

    // Now we can build the folder from the padded icon_id
    folder_id = icon_id[0] + icon_id[1] + icon_id[2] + '000'

    return 'https://xivapi.com/i/' + folder_id +'/' + icon_id + '_hr1.png'
}

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });
client.once('ready', () => {
    console.log('Ready!');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'windows') {
        await interaction.deferReply();
        const fish = interaction.options.getString('fish');
        const numWindows = Math.min(10, interaction.options.getInteger('number_of_windows') || 5)
        const displayDowntime = interaction.options.getBoolean('display_downtime') === null? true: interaction.options.getBoolean('display_downtime')
        const compactMode = interaction.options.getBoolean('compact_mode') === null? true: interaction.options.getBoolean('compact_mode') 
        const displayDuration = interaction.options.getBoolean('display_duration') === null? false: interaction.options.getBoolean('display_duration')


        const embed = new MessageEmbed()
        try {
            const windows = await fetch('https://ff14-fish-planner.herokuapp.com/windows?format=discord&fish=' + encodeURIComponent(fish)).then(response => response.json());
            embed.setColor('#1fa1e0')
                .setAuthor('Upcoming windows for: ' + fish)
                .setThumbnail(guessIconUrl(windows.icon))
                .setFooter('Based on FFX|V Fish Tracker App by Carbuncle Plushy. Run time: ' + windows.runtime.substring(0, 5) + 'ms')            
                const availabilities = windows.availability.slice(0, numWindows)
                let windowStrings
                if(compactMode) {
                    windowStrings = availabilities.map(a => (a.start - Date.now() < 8.64e+7?`<t:${(a.start / 1000).toFixed(0)}:R>`:`<t:${(a.start / 1000).toFixed(0)}:d> <t:${(a.start / 1000).toFixed(0)}:t>`)+ `${displayDuration? ' ('+ a.duration + ')': ''}${displayDowntime? '; ' + a.downtime:''}`)
                    embed.addField('Next Window Start'+(displayDuration?' (Duration)': '') + (displayDowntime?'; Downtime':''), windowStrings.join('\n'), true)
                } else {
                    windowStrings = availabilities.map(a => `<t:${(a.start / 1000).toFixed(0)}:${(a.start - Date.now() < 8.64e+7)?'R':'D'}>`)  //shows relative time under 24h
                    embed.addField('Next Start', windowStrings.join('\n'), true)
                    if(displayDuration) {
                        embed.addField('Duration', availabilities.map(a => `${a.duration}`).join('\n'), true)
                    }
                    if(displayDowntime) {
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
});

client.login(token);