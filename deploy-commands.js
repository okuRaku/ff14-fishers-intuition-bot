const { SlashCommandBuilder } = require('@discordjs/builders');
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
        .addStringOption(option => option.setName('fish').setRequired(true).setDescription('Desired fish, any language, exact spelling.'))
        .addIntegerOption(option => option.setName('number_of_windows').setRequired(false).setDescription('How many upcoming windows to show.  Minimum 1, maximum 10.  Default 5.'))
        .addBooleanOption(option => option.setName('display_duration').setRequired(false).setDescription('Display window durations, useful on fish where it can vary.  Default false.'))
        .addBooleanOption(option => option.setName('display_downtime').setRequired(false).setDescription('Display downtime between windows, varies due to weather randomness.  Default true.'))
        .addBooleanOption(option => option.setName('compact_mode').setRequired(false).setDescription('Compact view more suitable for mobile.  Default true.')),
    new SlashCommandBuilder().setName('bitetimes')
        .setDescription('Bite timings for a spot.  Based on FFXIV Teamcraft')
]
    .map(command => command.toJSON());

const rest = new REST({ version: '9' }).setToken(token);

rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
    .then(() => console.log('Successfully registered application commands.'))
    .catch(console.error);