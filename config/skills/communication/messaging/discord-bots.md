---
name: discord-bots
description: Discord bot development with discord.js
trigger_patterns:
  - "discord"
  - "discord bot"
  - "discord.js"
  - "discord slash command"
capabilities:
  - communication
version: "1.0.0"
sources:
  - name: discord.js
    url: https://github.com/discordjs/discord.js
    license: Apache-2.0
---
# Discord Bots with discord.js

## Client Setup
```typescript
import { Client, GatewayIntentBits, Events } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
```

## Slash Commands
```typescript
import { SlashCommandBuilder, REST, Routes } from 'discord.js';

// Register command
const command = new SlashCommandBuilder()
  .setName('task')
  .setDescription('Create a new task')
  .addStringOption(opt => opt.setName('title').setDescription('Task title').setRequired(true))
  .addStringOption(opt => opt
    .setName('priority')
    .setDescription('Priority level')
    .addChoices(
      { name: 'High', value: 'high' },
      { name: 'Medium', value: 'medium' },
      { name: 'Low', value: 'low' },
    ));

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
await rest.put(Routes.applicationCommands(clientId), { body: [command.toJSON()] });

// Handle command
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'task') {
    const title = interaction.options.getString('title', true);
    const priority = interaction.options.getString('priority') ?? 'medium';
    await interaction.reply(`Created task: "${title}" (${priority})`);
  }
});
```

## Embeds
```typescript
import { EmbedBuilder } from 'discord.js';

const embed = new EmbedBuilder()
  .setTitle('Task Created')
  .setDescription('Your task has been created successfully.')
  .setColor(0x1a1a2e)
  .addFields(
    { name: 'Title', value: 'Review PR', inline: true },
    { name: 'Priority', value: 'High', inline: true },
  )
  .setTimestamp();

await interaction.reply({ embeds: [embed] });
```

## Components (Buttons, Selects)
```typescript
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId('approve').setLabel('Approve').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('reject').setLabel('Reject').setStyle(ButtonStyle.Danger),
);

await interaction.reply({ content: 'Please decide:', components: [row] });

// Handle button
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId === 'approve') {
    await interaction.update({ content: 'Approved!', components: [] });
  }
});
```

## Best Practices
- Use slash commands instead of prefix commands (modern Discord)
- Request only necessary gateway intents (privacy and performance)
- Defer replies for long-running operations (`interaction.deferReply()`)
- Handle rate limits gracefully (discord.js handles most automatically)
- Use sharding for bots in 2500+ servers
