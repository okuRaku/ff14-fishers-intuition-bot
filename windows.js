const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { EmbedBuilder } = require('discord.js');

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

const toTitleCase = (phrase) => {
    return phrase
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
};

const getWindowsForFish = async (fish) => {
    const windows = await fetch('https://ff14-fish-windows.fly.dev/windows?format=discord&fish=' + encodeURIComponent(fish)).then(response => response.json());
    return windows
};

module.exports = {
    getWindowsForFish: getWindowsForFish,
    buildEmbed: async (fish, numWindows, displayDowntime, compactMode, displayDuration, cachedWindowData = undefined, authorTextPrefix = 'Upcoming windows for: ') => {
        const embed = new EmbedBuilder()
        try {
            const windows = cachedWindowData || await getWindowsForFish(fish)
            embed.setColor('#1fa1e0')
                .setThumbnail(guessIconUrl(windows.icon, true))
                .setFooter({text: 'Based on FFX|V Fish Tracker App by Carbuncle Plushy.'}) // Run time: ' + windows.runtime.substring(0, 5) + 'ms'})
            if(null != windows.folklore) {
                embed.setAuthor({
                    name: authorTextPrefix + toTitleCase(fish),
                    iconURL: 'https://xivapi.com/i/026000/026164.png',
                    url: 'https://ffxivteamcraft.com/search?type=Item&query=' + encodeURIComponent(windows.folklore)})
                     .setDescription(windows.folklore)
            } else {
                embed.setAuthor(
                    {name: authorTextPrefix + toTitleCase(fish)})
            }

            const availabilities = windows.availability.slice(0, numWindows)
            let windowStrings
            if (compactMode) {
                windowStrings = availabilities.map(a => (a.start - Date.now() < 3.6e+6 ? `<t:${(a.start / 1000).toFixed(0)}:R>` : `<t:${(a.start / 1000).toFixed(0)}:d> <t:${(a.start / 1000).toFixed(0)}:t>`) + `${displayDuration ? ' (' + a.duration + ')' : ''}${displayDowntime ? ' / ' + a.downtime : ''}`)
                embed.addFields({name: 'Next Window' + (displayDuration ? ' (Duration)' : '') + (displayDowntime ? ' / Downtime' : ''), value: windowStrings.join('\n'), inline: true})
            } else {
                windowStrings = availabilities.map(a => `<t:${(a.start / 1000).toFixed(0)}:${(a.start - Date.now() < 3.6e+6) ? 'R' : 'D'}>`)  //shows relative time under 1h
                embed.addFields({name: 'Next Start', value: windowStrings.join('\n'), inline: true})
                if (displayDuration) {
                    embed.addFields({name: 'Duration', value: availabilities.map(a => `${a.duration}`).join('\n'), inline: true})
                }
                if (displayDowntime) {
                    embed.addFields({name: 'Downtime', value: availabilities.map(a => `${a.downtime || '\u200b'}`).join('\n'), inline: true})
                }

            }

        } catch (e) {
            console.log(e)
            embed.setColor('#1fa1e0')
                .setTitle('Found no windows for: ' + fish)
                .setThumbnail('https://xivapi.com/i/001000/001135.png')
                .setFooter({text: 'If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417'})
                .setDescription('Please use exact spelling, with spaces and punctuation.  Click the above title link to search Teamcraft for your fish.')
                .setURL('https://ffxivteamcraft.com/search?type=Item&query=' + encodeURIComponent(fish))
        }
        return embed
    }
};