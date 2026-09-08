---
name: translation
description: Software translation and localization best practices using i18next
trigger_patterns:
  - "translate"
  - "translation"
  - "localization"
  - "i18n"
  - "multilingual"
capabilities:
  - translation
  - localization
  - i18n-setup
version: "1.0.0"
sources:
  - name: i18next
    url: https://github.com/i18next/i18next
    license: MIT
---
# Translation

## i18next Setup
- Namespace per module: `config/i18n/{lang}/{module}.json`
- Default language: English (en)
- Fallback chain: user locale → en
- Lazy-load language files — only load what's needed

## Translation File Structure
```json
{
  "module_name": {
    "title": "Module Title",
    "actions": {
      "save": "Save",
      "cancel": "Cancel",
      "delete": "Delete"
    },
    "messages": {
      "success": "Operation completed successfully",
      "error": "An error occurred: {{details}}"
    }
  }
}
```

## Best Practices
- Never concatenate translated strings: `t('greeting', { name })` not `t('hello') + name`
- Use ICU message format for plurals: `{count, plural, one {# item} other {# items}}`
- Keep keys semantic: `user.profile.title` not `page3.header`
- Include context for translators: `"save_button": "Save"` with comment
- Handle RTL languages in CSS (logical properties: inline-start/inline-end)

## Hungarian (hu) Specifics
- Formal "you" (On/Onok) for business apps, informal (te/ti) for casual
- Date format: YYYY. MM. DD. (note the dots and spaces)
- Number format: 1 234 567,89 (space as thousands, comma as decimal)
- Currency: 1 234 Ft or 1 234 HUF
- Address format: country, postal code, city, street

## Translation Workflow
1. Developer adds English strings with i18next keys
2. Extract new/changed keys: compare translation files
3. Send to translator with context and screenshots
4. Review translated strings in context (not just text)
5. Test with pseudo-localization (detect hardcoded strings)
6. Verify layout with long translations (German is ~30% longer than English)

## Common Mistakes
- Hardcoded strings in components
- Assuming all languages are left-to-right
- Not handling plural forms correctly (some languages have 3+ plural forms)
- Translating technical terms that should stay in English
- Missing context for ambiguous words
