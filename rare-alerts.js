const { ChannelType } = require('discord.js');
const windows = require('./windows');
const cron = require('node-cron');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const windowCache = {}
const updateRareWindowCache = async (fish) => {
    console.log('!!!! Updating window cache for %s at %s', fish, new Date().toUTCString())
    const rareWindowData = await windows.getWindowsForFish(fish)
    windowCache[fish] = rareWindowData
}
const rareFishBackgroundChecker = (fish, channelId, alertRole) => {
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
            if (Date.now() > messagesResume && !("DISABLE_ALERTS" in process.env && process.env.DISABLE_ALERTS === "true")) {

                windowCache[fish].availability = windowCache[fish].availability.filter(x => x.start > Date.now())

                // nextWindowIndex = windowCache[fish].availability.findIndex((x) => x.start > Date.now())
                windowOpen = windowCache[fish].availability[0].start
                diffMillis = (windowOpen - Date.now())

                // If there's a known maintenance window coming up, no need to alert
                let upcomingKnownMaintenance = false;
                const lodestone = await fetch('https://lodestonenews.com/news/maintenance/current').then(response => response.json());
                if (lodestone && lodestone.game && lodestone.game.some((maint) => {
                    return (windowOpen > Date.parse(maint.start) && windowOpen < Date.parse(maint.end))
                })) {
                    upcomingKnownMaintenance = true;
                }

                // set up some intervals in millis
                const [intervalLong, intervalMedium, intervalShort, intervalImminent] =
                    [
                        1440 * 60 * 1000,  // 24 hours
                        240 * 60 * 1000,   // 4 hours
                        60 * 60 * 1000,    // 1 hour
                        30 * 60 * 1000     // 30 minutes
                    ]

                let alertMessage;
                if (diffMillis <= 0) { } // do nothing, should not happen
                else if (diffMillis < intervalImminent) {
                    console.log('Preparing an "imminent" alert for %s at %s', fish, new Date().toUTCString());
                    const embed = await windows.buildEmbed(fish, 1, true, true, false, windowCache[fish], 'Under 30m alert for: ')
                    const contentString = upcomingKnownMaintenance ?
                        '🚧Maintenance🚧 a rare window would have been imminent..' :
                        `<@&${alertRole}> a rare window is imminent...`
                    alertMessage = {
                        content: contentString,
                        embeds: [embed]
                    };
                    messagesResume = windowOpen;
                }
                else if (diffMillis < intervalShort) {
                    console.log('Preparing  a "short" alert for %s at %s', fish, new Date().toUTCString());
                    const embed = await windows.buildEmbed(fish, 1, true, true, false, windowCache[fish], 'Under 1h alert for: ')
                    const contentString = upcomingKnownMaintenance ?
                        '🚧Maintenance🚧 a rare window would have been less than an hour away..' :
                        `<@&${alertRole}> a rare window is less than an hour away...`
                    alertMessage = {
                        content: contentString,
                        embeds: [embed]
                    };
                    messagesResume = Date.now() + (diffMillis - intervalImminent);
                }
                else if (diffMillis < intervalMedium) {
                    console.log('Preparing an "medium" alert for %s at %s', fish, new Date().toUTCString());
                    const embed = await windows.buildEmbed(fish, 1, true, true, false, windowCache[fish], 'Under 4h alert for: ')
                    const contentString = upcomingKnownMaintenance ?
                        '🚧Maintenance🚧 a rare window would have been less than four hours away..' :
                        `<@&${alertRole}> a rare window is less than four hours away...`
                    alertMessage = {
                        content: contentString,
                        embeds: [embed]
                    };
                    messagesResume = Date.now() + (diffMillis - intervalShort);
                }
                else if (diffMillis < intervalLong) {
                    console.log('Preparing an "long" alert for %s at %s', fish, new Date().toUTCString());
                    const embed = await windows.buildEmbed(fish, 1, true, true, false, windowCache[fish], 'Under 24h alert for: ')
                    const contentString = upcomingKnownMaintenance ?
                        '🚧Maintenance🚧 a rare window would have been less than a day away..' :
                        `<@&${alertRole}> a rare window is less than a day away...`
                    alertMessage = {
                        content: contentString,
                        embeds: [embed]
                    };
                    messagesResume = Date.now() + (diffMillis - intervalMedium);
                }
                if (alertMessage) {
                    const channel = client.channels.cache.get(channelId);
                    channel.messages.fetch({ limit: 20 }).then(messages => {
                        // make sure the embed wasn't already sent before proceeding
                        if (messages.size > 0 && messages.every(message => !(message.embeds[0] && message.embeds[0].equals(alertMessage.embeds[0])))) {
                            channel.send(alertMessage).then((sent_alert) => {
                                if (channel.type === ChannelType.GuildAnnouncement) {
                                    sent_alert.crosspost()
                                        .then(() => console.log('Crossposted message'))
                                        .catch(console.error);
                                }
                            })
                        } else {
                            console.log('Alert for %s at %s was not sent due to duplicate.', fish, new Date().toUTCString());
                        }
                    }).catch(console.error);
                }
            } else {
                console.log('Task ran, but messages paused till %s for %s at %s', new Date(messagesResume).toUTCString(), fish, new Date().toUTCString());
            }
        });
    })
}

module.exports = {
    rareFishBackgroundChecker: rareFishBackgroundChecker,
}

