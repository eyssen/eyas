---
name: email-parsing
description: Parsing email messages (MIME) with mailparser
trigger_patterns:
  - "parse email"
  - "mailparser"
  - "mime"
  - "email attachment"
  - "email extract"
capabilities:
  - communication
version: "1.0.0"
sources:
  - name: mailparser
    url: https://github.com/nodemailer/mailparser
    license: MIT
---
# Email Parsing with mailparser

## Parsing a Complete Email
```typescript
import { simpleParser } from 'mailparser';

const parsed = await simpleParser(emailSource); // Buffer or string (raw MIME)

console.log(parsed.from?.text);         // "Alice <alice@example.com>"
console.log(parsed.to?.text);           // "Bob <bob@example.com>"
console.log(parsed.subject);            // "Meeting Tomorrow"
console.log(parsed.date);               // Date object
console.log(parsed.text);               // plain text body
console.log(parsed.html);               // HTML body (or false)
console.log(parsed.attachments.length); // number of attachments
```

## Extracting Attachments
```typescript
for (const attachment of parsed.attachments) {
  console.log(attachment.filename);     // 'report.pdf'
  console.log(attachment.contentType);  // 'application/pdf'
  console.log(attachment.size);         // bytes
  const buffer = attachment.content;    // Buffer with file data
  // Save or process the attachment
}
```

## Headers
```typescript
// Access specific headers
const messageId = parsed.messageId;
const inReplyTo = parsed.inReplyTo;
const references = parsed.references;     // array of message IDs
const headers = parsed.headers;            // Map of all headers

// Custom headers
const customHeader = parsed.headers.get('x-custom-header');
```

## Streaming Parser (Large Emails)
```typescript
import { MailParser } from 'mailparser';

const parser = new MailParser();

parser.on('headers', (headers) => {
  console.log(headers.get('subject'));
});

parser.on('data', (data) => {
  if (data.type === 'attachment') {
    data.content.pipe(writeStream);
    data.release();
  }
  if (data.type === 'text') {
    console.log(data.text);
  }
});

sourceStream.pipe(parser);
```

## Common Use Cases
- Inbound email processing (support tickets, lead capture)
- Email archiving and search indexing
- Attachment extraction for document processing
- Thread reconstruction using `In-Reply-To` and `References` headers

## Best Practices
- Handle both plain text and HTML bodies (prefer text for processing)
- Sanitize HTML body before rendering (XSS prevention)
- Validate attachment types and sizes before processing
- Use streaming parser for emails with large attachments
- Preserve original MIME source for audit compliance
