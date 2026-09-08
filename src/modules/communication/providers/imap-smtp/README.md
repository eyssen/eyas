# imap-smtp provider

Hardened IMAP/SMTP helpers used on top of the existing
`src/modules/communication/submodules/email/adapter.ts` polling loop.

Everything here is **pure, dependency-free TypeScript**. The helpers take
`string | Uint8Array` / raw headers and return structured values; they never
open a socket themselves. Connection concerns (IMAP login, IDLE, SMTP send)
remain in the live adapter.

## Modules

| File                    | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `mime-parser.ts`        | RFC 5322 / 2045 parser. Multipart, QP/base64, RFC 2047 headers.         |
| `address-parser.ts`     | Recursive-descent RFC 5322 address list parser.                         |
| `thread-builder.ts`     | Simplified JWZ threading (union-find over Message-ID / References).    |
| `signature-stripper.ts` | `-- ` delimiter + heuristic sign-offs + quoted-reply removal.           |
| `html-to-text.ts`       | Dependency-free tag stripper with entity decode.                        |
| `connection-pool.ts`    | Pool helpers for `imapflow` / `nodemailer` reuse (VCS-agnostic types).  |
| `oauth-imap.ts`         | XOAUTH2 SASL string builder + token-refresh wrapper placeholder.        |
| `index.ts`              | `createImapSmtpProvider(deps)` factory that wires the helpers.          |

## Wiring with the existing adapter

`submodules/email/adapter.ts` already opens connections and fetches raw
messages. In a follow-up router session, pass the adapter (or a thin wrapper
around it) as `rawFetcher` to `createImapSmtpProvider`:

```ts
import { createImapSmtpProvider, ThreadIndex } from '@modules/communication/providers/imap-smtp'

const provider = createImapSmtpProvider({
  logger: log,
  rawFetcher: imapSmtpAdapter,   // returns { uid, raw: Uint8Array }
  threadIndex: new ThreadIndex(),
})

await provider.init()
const stop = await provider.startListener(async (email) => {
  // email is a normalized InboundEmail from email-common/types.ts
})
```

## Safety notes

- **No XML**, no XXE: MIME is not XML.
- **No DOM**, no HTML execution: `htmlToText` is a plain token scanner.
- **Hard caps**: `maxBytes`, `maxDepth`, `maxParts` on every parser.
- **No dynamic code evaluation**: no `eval`, no dynamic function constructors,
  no `innerHTML`.
- Attachment bodies are returned as `Uint8Array`; the `documents` module
  is responsible for virus scanning / type gating before persisting.
