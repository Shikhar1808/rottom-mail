# 08 · Senders and Ethereal

A **sender** is not a person. It's a **mailbox** used as the "From" address, e.g. `kaden.wolf41@ethereal.email`. A logged-in user owns and uses senders. Google login only identifies the user and grants **no** permission to send mail.

## How a sender mailbox is created

Ethereal allows two ways: `nodemailer.createTestAccount()` (asks Ethereal's API for a mailbox, or uses a cached one), or one click on ethereal.email. No signup, no verification.

```ts
const acc = await nodemailer.createTestAccount();
// acc.user → "kaden.wolf41@ethereal.email"  (also the From address)
// acc.pass → random password
// acc.smtp → { host: 'smtp.ethereal.email', port: 587, secure: false }
// acc.imap → { host: 'imap.ethereal.email', port: 993, secure: true }   ← used by the crash check
await prisma.sender.create({ data: {
  userId, email: acc.user, smtpUser: acc.user, smtpPassEnc: encrypt(acc.pass),
  smtpHost: acc.smtp.host, smtpPort: acc.smtp.port, imapHost: acc.imap.host, imapPort: acc.imap.port,
}});
```

## Chosen: option B, mailboxes auto-created per user

| Option | How | Verdict |
|---|---|---|
| A. Seed script | `npm run seed:senders -- 3`, shared by everyone | Simplest, but users share hourly limits |
| **B. Auto-create per user** | 2 mailboxes owned by the user, created on first Compose. "Add sender" creates more | ✅ tenant isolation, no setup for reviewers |
| C. Paste credentials | form for SMTP/IMAP details | Closest to real products, but manual |

### Rules

| Moment | What happens |
|---|---|
| New user logs in | Nothing yet (login never waits on Ethereal) |
| First time Compose opens (`GET /api/senders`) and the user has **0 active** senders | Create `DEFAULT_SENDERS_PER_USER` (2) mailboxes |
| Later logins | Same senders reused |
| "+ Add mailbox" next to From in Compose (`POST /api/senders`) | One more, up to `MAX_SENDERS_PER_USER` (5), and it becomes the selected sender |
| SMTP login fails (`535`) | Sender becomes `broken`. If 0 active remain, 2 new ones are created on the next Compose |
| Two tabs open Compose at once | Redis lock `SET provision:<userId> NX EX 30`: only one request creates mailboxes, the other waits and then reads them |

```
Day 1  prithvi → Compose → gets kaden.wolf41@ethereal.email + mia.ruiz@ethereal.email
Day 2  prithvi → Compose → same two senders
Day 2  rahul (new user) → Compose → his own two, separate from prithvi's
```

- **Why 2:** enough to show multiple senders and per-sender limits in the demo. It's an env value, so it can be 1.
- **Why a cap:** Ethereal is a free public service, so this stops anyone from creating hundreds of mailboxes through the app.
- **At scale:** 1000 users means about 2000 Ethereal mailboxes. Fine for a demo. A real product would have users connect their own mailboxes (option C, or Gmail/Outlook OAuth).

## SMTP sending

- One **pooled** nodemailer transporter per sender, cached in each worker (`pool: true, maxConnections: 2`), so there's no reconnect per email.
- Every message gets a fixed `Message-ID: <email.id@reachinbox.local>` (for the crash check).
- `nodemailer.getTestMessageUrl(info)` gives the Ethereal preview link, saved as `previewUrl`.
- `SMTP_MODE=fake` uses nodemailer's `jsonTransport` (nothing sent) for load tests.

## Ethereal facts and what they change

| Ethereal fact (FAQ) | Impact on the design |
|---|---|
| **Nothing is delivered**: all emails are caught and stored | Safe to test with real-looking lead lists |
| **Public accounts can send up to 200 messages/hour**, then Ethereal rejects more until the next hour | `MAX_EMAILS_PER_HOUR_PER_SENDER ≤ 200`. In global mode one sender can go over it, which is an argument for per-sender limiting |
| That rejection is **temporary** | SMTP 4xx: move to the next window, not counted as a failure. 5xx: failed |
| **Messages are kept for a few hours**, then deleted | Preview links expire, so the UI shows "preview expired". The audit `sent` event keeps the SMTP reply as lasting proof. The crash check runs within ~30s, and "not found" is only trusted for attempts under an hour old |
| **100MB quota per address** | Fine for the demo. Big load tests use `SMTP_MODE=fake`. Attachments go with every email, so they're capped at 2 MB per campaign ([02 D28](./02-design-decisions.md#d28--formatted-messages-and-attachments-)) |
| Public accounts can't **receive** inbound mail | Not relevant: we only send from them |
| How long accounts last isn't documented | `535` on login: mark the sender broken and create a new one |
| IMAP/POP3 access is available | Used by the Option C check. Live-tested: caught messages are in **INBOX**, and `SEARCH HEADER Message-ID` finds them ([references](./references.md#ethereal)) |

Source: [Ethereal FAQ](https://ethereal.email/faq).
