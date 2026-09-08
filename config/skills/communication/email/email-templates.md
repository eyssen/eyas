---
name: email-templates
description: HTML email template design and rendering best practices
trigger_patterns:
  - "email template"
  - "html email"
  - "email design"
  - "transactional email"
capabilities:
  - communication
version: "1.0.0"
---
# Email Templates

## HTML Email Constraints
- Use tables for layout (flexbox/grid not supported in most email clients)
- Inline CSS styles (many clients strip `<style>` tags)
- Use absolute URLs for images
- Maximum width: 600px for best compatibility
- Avoid JavaScript — it is always stripped

## Basic Template Structure
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0; padding:0; background-color:#f4f4f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:20px 0;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="background-color:#ffffff; border-radius:8px;">
          <!-- Header -->
          <tr>
            <td style="padding:30px 40px; text-align:center;">
              <img src="https://example.com/logo.png" alt="EYAS" width="120">
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:20px 40px; font-family:Arial,sans-serif; font-size:16px; color:#333;">
              <h1 style="margin:0 0 16px; font-size:24px;">Hello {{name}}</h1>
              <p style="margin:0 0 16px;">{{content}}</p>
              <a href="{{actionUrl}}" style="display:inline-block; padding:12px 24px;
                 background-color:#1a1a2e; color:#ffffff; text-decoration:none;
                 border-radius:6px;">{{actionText}}</a>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px; font-size:12px; color:#999; text-align:center;">
              <p>You received this because you are subscribed to EYAS notifications.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

## Template Rendering
```typescript
function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] ?? match;
  });
}
```

## Dark Mode Support
```html
<style>
  @media (prefers-color-scheme: dark) {
    .email-body { background-color: #1a1a1a !important; }
    .email-text { color: #e0e0e0 !important; }
  }
</style>
```
Note: dark mode CSS support varies widely across email clients.

## Testing
- Test in major clients: Gmail, Outlook, Apple Mail, Yahoo
- Use Litmus or Email on Acid for cross-client rendering
- Check plain text fallback
- Verify links and tracking pixels work

## Best Practices
- Always provide a plain text alternative
- Include an unsubscribe link for marketing emails
- Use web-safe fonts (Arial, Helvetica, Georgia, Times New Roman)
- Keep email size under 100KB for fast loading
- Pre-header text: first 40-100 characters show as preview in inbox
