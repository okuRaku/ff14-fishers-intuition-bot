const { ChannelType, TextDisplayBuilder, MessageFlags, SectionBuilder, ButtonStyle } = require('discord.js');
const windows = require('./windows');
const cron = require('node-cron');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const rareFishBackgroundChecker = (fish, fishGuide, cachedRareWindows, channelId, alertRole, client) => {
    let messagesResume = 0;
    let windowOpen = 0;
    let diffMillis = 0;

    const task = cron.schedule('15,30,45,0 * * * *', async () => {
        console.log('Checking %s at %s', fish, new Date().toUTCString())

        if (Date.now() > messagesResume && !("DISABLE_ALERTS" in process.env && process.env.DISABLE_ALERTS === "true")) {
            const relevantWindows = cachedRareWindows.filter(x => x.startMs > Date.now())

            // nextWindowIndex = windowCache[fish].availability.findIndex((x) => x.start > Date.now())
            windowOpen = relevantWindows[0].startMs
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

            const section = new SectionBuilder()
                .addTextDisplayComponents(
                    textDisplay => textDisplay
                        .setContent('For more commands, try `/`. For more windows: '),
                )
                .setButtonAccessory(
                    button => button
                        // [, fishId, pageNumber, pageSize, displayDowntime, displayDuration]
                        .setCustomId(`dm_me_more_windows-${fishGuide.id}-0-5-true-false`)
                        .setLabel('DM /windows')
                        .setEmoji({ id: "1254442517248872528", name: "BigPixelFisher" })
                        .setStyle(ButtonStyle.Secondary),
                );

            if (diffMillis <= 0) { } // do nothing, should not happen
            else if (diffMillis < intervalImminent) {
                console.log('Preparing an "imminent" alert for %s at %s', fish, new Date().toUTCString());
                const container = await windows.buildEmbed('en', [relevantWindows.shift()], true, false, fishGuide, 'Under 30m Alert')
                const contentString = new TextDisplayBuilder().setContent(
                    upcomingKnownMaintenance ?
                        '🚧Maintenance🚧 a rare window would have been imminent..' :
                        `<@&${alertRole}> a rare window is imminent...`
                );
                alertMessage = {
                    components: [contentString, container.addSectionComponents(section)],
                    flags: MessageFlags.IsComponentsV2,
                };
                messagesResume = windowOpen;
            }
            else if (diffMillis < intervalShort) {
                console.log('Preparing  a "short" alert for %s at %s', fish, new Date().toUTCString());
                const container = await windows.buildEmbed('en', [relevantWindows.shift()], true, false, fishGuide, 'Under 1h Alert')
                const contentString = new TextDisplayBuilder().setContent(
                    upcomingKnownMaintenance ?
                        '🚧Maintenance🚧 a rare window would have been less than an hour away..' :
                        `<@&${alertRole}> a rare window is less than an hour away...`
                );
                alertMessage = {
                    components: [contentString, container.addSectionComponents(section)],
                    flags: MessageFlags.IsComponentsV2,
                };
                messagesResume = Date.now() + (diffMillis - intervalImminent);
            }
            else if (diffMillis < intervalMedium) {
                console.log('Preparing an "medium" alert for %s at %s', fish, new Date().toUTCString());
                const container = await windows.buildEmbed('en', [relevantWindows.shift()], true, false, fishGuide, 'Under 4h Alert')
                const contentString = new TextDisplayBuilder().setContent(
                    upcomingKnownMaintenance ?
                        '🚧Maintenance🚧 a rare window would have been less than four hours away..' :
                        `<@&${alertRole}> a rare window is less than four hours away...`
                );
                alertMessage = {
                    components: [contentString, container.addSectionComponents(section)],
                    flags: MessageFlags.IsComponentsV2,
                };
                messagesResume = Date.now() + (diffMillis - intervalShort);
            }
            else if (diffMillis < intervalLong) {
                console.log('Preparing an "long" alert for %s at %s', fish, new Date().toUTCString());
                const container = await windows.buildEmbed('en', [relevantWindows.shift()], true, false, fishGuide, 'Under 24h Alert')
                const contentString = new TextDisplayBuilder().setContent(
                    upcomingKnownMaintenance ?
                        '🚧Maintenance🚧 a rare window would have been less than a day away..' :
                        `<@&${alertRole}> a rare window is less than a day away...`
                );
                alertMessage = {
                    components: [contentString, container.addSectionComponents([section])],
                    flags: MessageFlags.IsComponentsV2,
                };
                messagesResume = Date.now() + (diffMillis - intervalMedium);
            }

            if (alertMessage) {
                const channel = client.channels.cache.get(channelId);

                function collectLeafContents(components) {
                    let contents = [];

                    for (const comp of components) {
                        // if the component has its own .components array, recurse
                        if (comp.components && Array.isArray(comp.components) && comp.components.length > 0) {
                            contents.push(...collectLeafContents(comp.components));
                        } else if (typeof comp.content === "string" && comp.content.trim() !== "") {
                            // leaf node with text content
                            contents.push(comp.content);
                        }
                    }

                    return contents;
                }

                channel.messages.fetch({ limit: 20 }).then(messages => {
                    // make sure the embed wasn't already sent before proceeding
                    const alertContents = collectLeafContents(alertMessage.components);

                    const shouldSend = messages.size === 0 || messages.every(message => {
                        if (!(message.components && message.components.length)) return true;

                        const sentContents = collectLeafContents(message.components);

                        // Compare all alert leaf strings; if any already exist, treat as duplicate
                        return !alertContents.every(str => sentContents.includes(str));
                    });
                    if (shouldSend) {
                        channel.send(alertMessage).then(sent_alert => {
                            if (channel.type === ChannelType.GuildAnnouncement && (diffMillis > intervalImminent)) {
                                sent_alert.crosspost()
                                    .then(() => console.log('Crossposted message'))
                                    .catch(console.error);
                            }
                        });
                    } else {
                        console.log(
                            'Alert for %s at %s was not sent due to duplicate.',
                            fish,
                            new Date().toUTCString()
                        );
                    }
                }).catch(console.error);
            }
        } else {
            console.log('Task ran, but messages paused till %s for %s at %s', new Date(messagesResume).toUTCString(), fish, new Date().toUTCString());
        }
    });
}

module.exports = {
    rareFishBackgroundChecker: rareFishBackgroundChecker,
}

