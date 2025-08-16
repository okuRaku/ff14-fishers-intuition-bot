const { SlashCommandBuilder, ContextMenuCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { clientId, guildId, token } = require('./config.json');



///////////
// Turns out this was better to implement with select menus / components, but it was a lot of work so I'm holding here temporarily
///////////
// const bitetimesBuilder = new SlashCommandBuilder().setName('bitetimes')
//             .setDescription(
//                'Bite timings for a spot.  Based on FFXIV Teamcraft')
// ['norvrandt', 'black_shroud'].forEach(region => {
//     bitetimesBuilder.addSubcommandGroup(subcommandgroup => {
//         subcommandgroup.setName(region).setDescription('Bite timings for a spot.  Based on FFXIV Teamcraft');
//         ['the_crystarium', 'eulmore', 'lakeland', 'kholusia', 'amh_araeng', 'il_mheg', 'the_raktika_greatwood', 'the_tempest']
//             .forEach(zone => {
//                 subcommandgroup.addSubcommand(subcommand => subcommand.setName(zone).setDescription('Bite timings for a spot.  Based on FFXIV Teamcraft').addStringOption(option =>
//                     option.setName('spot').setDescription(region).setRequired(true).addChoices(
//                         [
//                             ['The Rift of Sighs', '111'],
//                             ['The Rusted Reservoir', 'val2'],
//                             ['The Source', 'val2'],
//                             ['Sullen', 'val2'],
//                             ['The Isle of Ken', 'val2']
//                         ])))
//             })
//         return subcommandgroup;
//     })
// })


const commands = [
    new SlashCommandBuilder().setName('windows')
        .setDescription(
            'Get upcoming windows for a fish.  Based on FFX|V Fish Tracker App')
        .addStringOption(option => option.setName('fish').setRequired(true).setDescription('Desired fish, any language.'))
        .addIntegerOption(option => option.setName('number_of_windows').setRequired(false).setDescription('How many upcoming windows to show.  Minimum 1, maximum 10.  Default 5.'))
        .addBooleanOption(option => option.setName('display_duration').setRequired(false).setDescription('Display window durations, useful on fish where it can vary.  Default false.'))
        .addBooleanOption(option => option.setName('display_downtime').setRequired(false).setDescription('Display downtime between windows, varies due to weather randomness.  Default true.'))
        .addBooleanOption(option => option.setName('compact_mode').setRequired(false).setDescription('Compact view more suitable for mobile.  Default true.')),
    new SlashCommandBuilder().setName('bitetimes')
        .setDescription('Bite timings for a spot.  Run without parameters (a menu will appear).  Based on FFXIV Teamcraft')
        .addStringOption(option => option.setName('plot_type').setRequired(false).setDescription('Optionally adjust plot type.')
            .addChoices(
                { name: 'box', value: 'box' },
                { name: 'histogram', value: 'histogram' },
            )),
    new SlashCommandBuilder().setName('timeline')
        .setDescription('View achievement timeline.')
        .addStringOption(option => option.setName('character_name').setRequired(true).setDescription('Character name.'))
        .addStringOption(option => option.setName('server').setRequired(true).setDescription('Character\'s server.'))
        .addStringOption(option => option.setName('achievement').setRequired(true).setDescription('Achievement to chart.').addChoices(
            { name: 'Good Things Come to Those Who Bait: La Noscea', value: 'Good Things Come to Those Who Bait: La Noscea' },
            { name: 'Good Things Come to Those Who Bait: Black Shroud', value: 'Good Things Come to Those Who Bait: Black Shroud' },
            { name: 'Good Things Come to Those Who Bait: Thanalan', value: 'Good Things Come to Those Who Bait: Thanalan' },
            { name: 'Baiting <Expansion>', value: 'Baiting' },
            { name: 'I Caught That', value: 'I Caught That' },
            { name: 'The One That Didn\'t Get Away', value: 'The One That Didn\'t Get Away' },
            { name: 'Go Big or Go Home', value: 'Go Big or Go Home' },
            { name: 'Go Big Far from Home', value: 'Go Big Far from Home' },
            { name: 'Go Big Till the End', value: 'Go Big Till the End' },
            { name: 'Skyward Rod', value: 'Skyward Rod' },
            { name: 'Dauntless Treader', value: 'Dauntless Treader' },
            { name: 'Specters of <Location>', value: 'Specters of' },
            { name: 'Denizens of <Location>', value: 'Denizens of' },
            { name: 'On a Boat', value: 'On a Boat' },
            { name: 'No More Fish in the Sea', value: 'No More Fish in the Sea' },
        ))
        .addStringOption(option => option.setName('except_ranks').setRequired(false).setDescription('Advanced: Give a comma separated list of ranks to exclude from the plot, e.g. 2,3')),
    new SlashCommandBuilder().setName('fishguide')
        .setDescription(
            'Fish details collected from in-game data as well as player recording and analysis.')
        .addStringOption(option => option.setName('fish').setRequired(true).setDescription('Desired fish. Has some flexiblity but try to match the name closely.'))
        .addStringOption(option => option.setName('language').setNameLocalizations({
            ja: '言語',
            de: 'sprache',
            fr: 'langue'
        }).setRequired(false).setDescription('Optionally select language.').setDescriptionLocalizations({
            ja: '(任意)言語を強制的に設定する。',
            de: 'Wählen Sie optional die Sprache aus.',
            fr: 'Sélectionnez éventuellement la langue.'
        })
            .addChoices(
                { name: 'English', value: 'en', name_localizations: { ja: '英語', de: 'Englisch', fr: 'Anglais' } },
                { name: 'Japanese', value: 'ja', name_localizations: { ja: '日本語', de: 'Japanisch', fr: 'Japonaise' } },
                { name: 'French', value: 'fr', name_localizations: { ja: 'フランス語', de: 'Französisch', fr: 'Français' } },
                { name: 'German', value: 'de', name_localizations: { ja: 'ドイツ語', de: 'Deutsch', fr: 'Allemande' } },
            ))
        .addBooleanOption(option => option.setName('fruity_guide').setRequired(false).setDescription('In this optional mode, only the Fruity Snacks video guide will be retrieved.'))
        .addBooleanOption(option => option.setName('spoiler').setRequired(false).setDescription('In this optional mode, text fields will be marked as spoilers')),
    new ContextMenuCommandBuilder().setName('Fruity Guide').setType(3),
    new SlashCommandBuilder().setName('weather')
        .setDescription(
            '(BETA) Weather prediction, with highlights for rare transitions.')
        .addStringOption(option => option.setName('region').setRequired(true).setDescription('Skywatcher region to predict.')
            .addChoices(
                { name: "La Noscea", value: "La Noscea" },
                { name: "The Black Shroud", value: "The Black Shroud" },
                { name: "Thanalan", value: "Thanalan" },
                { name: "Ishgard and Surrounding Areas", value: "Ishgard and Surrounding Areas" },
                { name: "Gyr Abania", value: "Gyr Abania" },
                { name: "The Far East", value: "The Far East" },
                { name: "Ilsabard", value: "Ilsabard" },
                { name: "Tural", value: "Tural" },
                { name: "Norvrandt", value: "Norvrandt" },
                { name: "Others", value: "Others" },
            ))
]
    .map(command => command.toJSON());

const rest = new REST({ version: '9' }).setToken(token);

rest.put(Routes.applicationCommands(clientId), { body: commands })
    // rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
    .then(() => console.log('Successfully registered application commands.'))
    .catch(console.error);