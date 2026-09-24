---
name: telegram-bots
description: Telegram bot development with grammY
trigger_patterns:
  - "telegram"
  - "telegram bot"
  - "grammy"
  - "telegram api"
capabilities:
  - communication
version: "1.0.0"
sources:
  - name: grammY
    url: https://github.com/grammyjs/grammY
    license: MIT
---
# Telegram Bots with grammY

## Basic Bot Setup
```typescript
import { Bot, Context } from 'grammy';

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

bot.command('start', (ctx) => ctx.reply('Welcome! I am EYAS assistant.'));
bot.command('help', (ctx) => ctx.reply('Available commands: /start, /help, /status'));

bot.on('message:text', (ctx) => {
  const text = ctx.message.text;
  ctx.reply(`You said: ${text}`);
});

bot.start();
```

## Webhook Mode (Production)
```typescript
import { webhookCallback } from 'grammy';

// Hono integration
app.post('/webhook/telegram', webhookCallback(bot, 'hono'));

// Set webhook URL
await bot.api.setWebhook('https://eyas.example.com/webhook/telegram');
```

## Keyboards and Buttons
```typescript
import { InlineKeyboard, Keyboard } from 'grammy';

// Inline keyboard (attached to message)
const inline = new InlineKeyboard()
  .text('Approve', 'action:approve')
  .text('Reject', 'action:reject');

await ctx.reply('Please decide:', { reply_markup: inline });

// Handle callback
bot.callbackQuery('action:approve', async (ctx) => {
  await ctx.answerCallbackQuery('Approved!');
  await ctx.editMessageText('Decision: Approved');
});
```

## Conversations (Multi-step)
```typescript
import { conversations, createConversation } from '@grammyjs/conversations';

async function createTask(conversation: any, ctx: Context) {
  await ctx.reply('What is the task title?');
  const titleCtx = await conversation.waitFor('message:text');
  const title = titleCtx.message.text;

  await ctx.reply('What is the priority? (high/medium/low)');
  const priorityCtx = await conversation.waitFor('message:text');
  const priority = priorityCtx.message.text;

  await ctx.reply(`Created task: "${title}" with priority ${priority}`);
}

bot.use(conversations());
bot.use(createConversation(createTask));
bot.command('newtask', (ctx) => ctx.conversation.enter('createTask'));
```

## File Handling
```typescript
bot.on('message:document', async (ctx) => {
  const file = await ctx.getFile();
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  // Download and process the file
});
```

## Best Practices
- Use webhook mode in production (more efficient than polling)
- Handle errors globally with `bot.catch()`
- Rate limit per-user to prevent abuse
- Store conversation state in database for persistence across restarts
- Use middleware for authentication and logging
