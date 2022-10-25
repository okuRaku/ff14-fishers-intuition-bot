const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { MessageEmbed } = require('discord.js');

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
    buildEmbed: async (fish, numWindows, displayDowntime, compactMode, displayDuration, cachedWindowData = undefined) => {
        const embed = new MessageEmbed()
        try {
            const windows = cachedWindowData || await getWindowsForFish(fish)
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
                windowStrings = availabilities.map(a => (a.start - Date.now() < 3.6e+6 ? `<t:${(a.start / 1000).toFixed(0)}:R>` : `<t:${(a.start / 1000).toFixed(0)}:d> <t:${(a.start / 1000).toFixed(0)}:t>`) + `${displayDuration ? ' (' + a.duration + ')' : ''}${displayDowntime ? ' / ' + a.downtime : ''}`)
                embed.addField('Next Window' + (displayDuration ? ' (Duration)' : '') + (displayDowntime ? ' / Downtime' : ''), windowStrings.join('\n'), true)
            } else {
                windowStrings = availabilities.map(a => `<t:${(a.start / 1000).toFixed(0)}:${(a.start - Date.now() < 3.6e+6) ? 'R' : 'D'}>`)  //shows relative time under 1h
                embed.addField('Next Start', windowStrings.join('\n'), true)
                if (displayDuration) {
                    embed.addField('Duration', availabilities.map(a => `${a.duration}`).join('\n'), true)
                }
                if (displayDowntime) {
                    embed.addField('Downtime', availabilities.map(a => `${a.downtime || '\u200b'}`).join('\n'), true)
                }

            }

        } catch (e) {
            console.log(e)
            embed.setColor('#1fa1e0')
                .setTitle('Found no windows for: ' + fish)
                .setThumbnail('https://xivapi.com/i/001000/001135.png')
                .setFooter('If this message persists, it may be a problem with the backend.  Please @mention okuRaku#1417')
                .setDescription('Please use exact spelling, with spaces and punctuation.  Click the above title link to search Teamcraft for your fish.')
                .setURL('https://ffxivteamcraft.com/search?type=Item&query=' + encodeURIComponent(fish))
        }
        return embed
    }
};