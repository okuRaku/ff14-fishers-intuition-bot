const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
let { clientId, guildId, token } = require('./config.json');

if('CLIENT_ID' in process.env) {
    clientId = process.env.CLIENT_ID
}
if('GUILD_ID' in process.env) {
    guildId = process.env.GUILD_ID
}
if('TOKEN' in process.env) {
    token = process.env.TOKEN
}

const commands = [
    new SlashCommandBuilder().setName('windows')
        .setDescription(
            'Get upcoming windows for a fish.  Based on FFX|V Fish Tracker App')
        .addStringOption(option => option.setName('fish').setRequired(true).setDescription('Desired fish, any language, exact spelling.'))
        .addIntegerOption(option => option.setName('number_of_windows').setRequired(false).setDescription('How many upcoming windows to show.  Minimum 1, maximum 10.  Default 5.'))
        .addBooleanOption(option => option.setName('display_duration').setRequired(false).setDescription('Display window durations, useful on fish where it can vary.  Default false.'))
        .addBooleanOption(option => option.setName('display_downtime').setRequired(false).setDescription('Display downtime between windows, varies due to weather randomness.  Default true.'))
        .addBooleanOption(option => option.setName('compact_mode').setRequired(false).setDescription('Compact view more suitable for mobile.  Default true.'))

]
    .map(command => command.toJSON());

const rest = new REST({ version: '9' }).setToken(token);

rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
    .then(() => console.log('Successfully registered application commands.'))
    .catch(console.error);