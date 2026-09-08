---
name: email-sending
description: Sending emails with Nodemailer via SMTP
trigger_patterns:
  - "send email"
  - "nodemailer"
  - "smtp"
  - "email"
  - "mail"
capabilities:
  - communication
version: "1.0.0"
sources:
  - name: nodemailer
    url: https://github.com/nodemailer/nodemailer
    license: MIT-0
---
# Email Sending with Nodemailer

## Basic Setup
```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.example.com',
  port: 587,
  secure: false,  // true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});
```

## Sending Email
```typescript
const info = await transporter.sendMail({
  from: '"EYAS" <noreply@example.com>',
  to: 'user@example.com',
  cc: 'manager@example.com',
  subject: 'Task Completed',
  text: 'Your task has been completed successfully.',
  html: '<h1>Task Completed</h1><p>Your task has been completed successfully.</p>',
});

console.log('Message sent:', info.messageId);
```

## Attachments
```typescript
await transporter.sendMail({
  from: '"EYAS" <noreply@example.com>',
  to: 'user@example.com',
  subject: 'Report',
  text: 'Please find the report attached.',
  attachments: [
    { filename: 'report.pdf', content: pdfBuffer },
    { filename: 'data.csv', path: '/path/to/data.csv' },
    { filename: 'logo.png', path: 'https://example.com/logo.png', cid: 'logo' },
  ],
});
```

## HTML Email with Inline Images
```typescript
const html = '<img src="cid:logo"/> <p>Welcome!</p>';
const attachments = [
  { filename: 'logo.png', path: '/assets/logo.png', cid: 'logo' },
];
```

## Testing with Ethereal
```typescript
const testAccount = await nodemailer.createTestAccount();
const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  auth: { user: testAccount.user, pass: testAccount.pass },
});

const info = await transporter.sendMail({ /* ... */ });
console.log('Preview:', nodemailer.getTestMessageUrl(info));
```

## Best Practices
- Use environment variables for SMTP credentials
- Set `from` address consistently (SPF/DKIM alignment)
- Always provide both `text` and `html` versions
- Rate limit outgoing emails to avoid being flagged as spam
- Handle SMTP errors gracefully (retry transient, alert on permanent)
- Use a queue for bulk email sending (do not send synchronously in request handlers)
