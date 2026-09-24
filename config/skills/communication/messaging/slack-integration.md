---
name: slack-integration
description: Slack app development with Bolt for JavaScript
trigger_patterns:
  - "slack"
  - "slack bot"
  - "slack app"
  - "bolt"
  - "slack integration"
capabilities:
  - communication
version: "1.0.0"
sources:
  - name: "@slack/bolt"
    url: https://github.com/slackapi/bolt-js
    license: MIT
---
# Slack Integration with Bolt

## App Setup
```typescript
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,  // for development
  appToken: process.env.SLACK_APP_TOKEN,
});

await app.start(3000);
```

## Listening to Messages
```typescript
// Match specific text
app.message('hello', async ({ message, say }) => {
  await say(`Hey there <@${message.user}>!`);
});

// Regex matching
app.message(/task (\d+)/, async ({ context, say }) => {
  const taskId = context.matches[1];
  await say(`Looking up task #${taskId}...`);
});
```

## Slash Commands
```typescript
app.command('/eyas', async ({ command, ack, respond }) => {
  await ack(); // acknowledge within 3 seconds

  const subcommand = command.text.split(' ')[0];
  switch (subcommand) {
    case 'status':
      await respond('All systems operational.');
      break;
    default:
      await respond(`Unknown command: ${subcommand}`);
  }
});
```

## Interactive Components
```typescript
// Block Kit message with button
app.command('/approve', async ({ ack, say }) => {
  await ack();
  await say({
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'New approval request' },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve' },
          action_id: 'approve_action',
          style: 'primary',
        },
      },
    ],
  });
});

// Handle button click
app.action('approve_action', async ({ ack, body, client }) => {
  await ack();
  await client.chat.update({
    channel: body.channel!.id,
    ts: body.message!.ts,
    text: `Approved by <@${body.user.id}>`,
  });
});
```

## Modals
```typescript
app.shortcut('open_modal', async ({ ack, client, shortcut }) => {
  await ack();
  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: { type: 'modal', title: { type: 'plain_text', text: 'Create Task' }, /* blocks */ },
  });
});
```

## Best Practices
- Use Socket Mode for development, HTTP mode with signing secret for production
- Acknowledge all interactive requests within 3 seconds
- Use Block Kit Builder to design message layouts visually
- Store bot token securely — never commit to version control
- Handle rate limits (Slack API: ~1 request per second per method)
