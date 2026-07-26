# Cognos Privacy Policy

**Last updated:** 10 July 2026

Cognos is an encrypted AI chat application by **Climacrux GmbH**, St. Niklausenstrasse 96, 6047
Kastanienbaum, Switzerland.

We built Cognos for private, useful AI conversations. This policy explains what we collect, what we
do with it, and what we deliberately do not do.

For privacy questions, contact us at **[support@cognos.io](mailto:support@cognos.io)**.

## The short version

Cognos stores your chat history in an encrypted form.

That means:

- **Stored chat history is encrypted so Cognos cannot read it from storage.**
- **Live AI requests are processed in plaintext by our backend and the selected AI provider so the
  AI can answer.**
- **We do not use your chats to train our own models.**
- **We do not sell your personal data.**
- **We do not share your data for advertising.**
- **We require approved AI providers not to use Cognos chats for training.**

This is not the same as full end-to-end encryption for the entire AI request path. Your stored
history is protected, but when you send a message, that message has to be processed so the AI can
respond.

## Who is responsible for your data?

The controller is:

**Climacrux GmbH**
St. Niklausenstrasse 96
6047 Kastanienbaum
Switzerland

Email: **[support@cognos.io](mailto:support@cognos.io)**

Privacy enquiries and data-rights requests are handled through the contact above. Cognos publishes
any legally required additional representative or privacy contact before offering the service in a
country where one is required.

## Who can use Cognos?

Cognos is intended for users aged **16 or older**. Do not use Cognos if you are below the minimum
age required to enter into this service in your country.

Cognos is available worldwide, with a primary focus on Switzerland, the UK, Germany, France, Spain,
Portugal, and Italy.

This policy currently covers the **Cognos web app**.

## What data we collect

### Account data

We collect the information needed to create, secure, and manage your account, such as:

- email address
- password hash and authentication data
- preferred language, theme, model, and privacy tier
- avatar icon and colour
- multi-factor authentication status, if enabled
- account settings and preferences
- billing status and subscription references

Current sign-in is email/password. Authenticator-app MFA is supported.

### Chat data

Your chats may include:

- messages and prompts
- AI responses
- generated content
- conversation titles
- summaries and memory used to make conversations work better
- supported file-derived context
- personas and settings
- redaction mappings

Stored chat history is encrypted at rest and decrypted client-side. Cognos does not store your
Account Key on our servers.

During a live AI request, your message is processed in plaintext by Cognos backend systems and by
the selected AI provider so the AI can generate a response.

### Files and attachments

You may upload supported files such as text, documents, PDFs, DOCX files, images, and code-like
text.

Files are processed in the browser where possible for extraction, redaction, and encryption. They
are encrypted before upload. File context may be sent to an AI provider when you use that file in a
message.

We do not use uploaded files to train models.

Cognos does not send uploads to a separate OCR, transcription, malware-scanning, or audio-upload
provider. The current subprocessor list is published on the Cognos website and is updated before a
new provider begins processing personal data.

### Billing data

Payments are handled by **Paddle**.

Cognos does not store full payment card details. Paddle handles payment cards, tax, checkout, and
invoices.

Cognos may store:

- Paddle customer and subscription IDs
- billing status
- invoice metadata
- business name
- VAT number
- billing country
- usage ledger data
- limited card display details, such as brand, last four digits, or expiry, if provided by Paddle

Billing records are linked to your account, but not to your chat content.

### Technical and usage data

We collect limited operational data to run, secure, and bill for the service, such as:

- IP address
- user agent
- timestamps
- routes and request status
- error information
- model used
- provider used
- privacy tier
- token counts
- cost and latency metadata
- billing identifiers

We do **not** intentionally log prompts, completions, message content, or encryption keys.

Approximate region may be inferred from your IP address by infrastructure or analytics providers. We
do not collect precise location.

### Analytics

Cognos may use privacy-friendly product analytics, such as Plausible, to understand aggregate
product usage.

If enabled, analytics are intended to be cookieless and not to include chat content, prompts,
completions, or personal identifiers.

We do not use session replay, heatmaps, keystroke logging, screen recording, or advertising pixels.

We aim to respect Do Not Track and Global Privacy Control signals where applicable.

## What we use data for

We process data to:

- provide the Cognos chat service
- store encrypted chat history
- route AI requests to selected models and providers
- manage accounts, login, and MFA
- process subscriptions and billing
- provide support
- secure the service
- prevent abuse
- maintain logs needed for operations and security
- improve product reliability and usability
- comply with legal, tax, and accounting obligations

## Legal bases

Where GDPR-style rules apply, we rely on these legal bases:

- **Contract:** to provide Cognos, manage accounts, process subscriptions, and deliver AI responses.
- **Legitimate interests:** to secure the service, prevent abuse, maintain essential logs, debug
  issues, and improve the product.
- **Legal obligation:** to keep records required for tax, accounting, and legal compliance.
- **Consent:** where required, for optional marketing or non-essential analytics.

## AI providers and model routing

Cognos lets users choose models. Model availability is gated by the user’s selected privacy tier,
such as Switzerland-only, EU, or global options.

When you send a message, Cognos routes the request to the selected or eligible AI provider. That
provider processes the prompt and response so the AI can answer.

We do not use your chats to train our own models.

We require approved AI providers not to use Cognos user data for training. Exact provider retention
terms depend on our contracts and provider configuration.

Current or expected AI infrastructure includes:

- Infomaniak for Swiss-hosted models
- Requesty as an EU gateway
- underlying model providers or hosts, to be confirmed in the subprocessor table

## Subprocessors: Who helps us run Cognos?

We use a small number of service providers to operate Cognos.

Some help us host the app, send emails, process payments, store encrypted backups, deliver the
website, or provide AI responses. They may process personal data only for those purposes.

Important distinction:

- hosting and backup providers mainly process encrypted stored data and technical metadata
- billing providers process payment and invoice data
- email providers process email addresses and email content
- AI providers process plaintext prompts and responses during live AI requests so the AI can answer

We do not let service providers sell Cognos user data or use it for advertising.

Some providers process only encrypted data or technical metadata. AI providers are different: they
process live prompts and responses in plaintext so the AI can answer. Stored chat history remains
encrypted so Cognos cannot read it from storage.

| Provider                  | What they do              | What they may process                               | Location     | Plaintext access?                                        |
| ------------------------- | ------------------------- | --------------------------------------------------- | ------------ | -------------------------------------------------------- |
| Hetzner                   | Hosting                   | Account data, encrypted stored data, logs, metadata | Germany / EU | No stored chat plaintext; may process technical metadata |
| Bunny.net                 | CDN/DNS                   | IP addresses and request metadata                   | EU/global    | No chat content                                          |
| BorgBase                  | Backups                   | Encrypted backups                                   | EU           | No chat content                                          |
| Scaleway                  | Transactional email       | Email address and email metadata                    | EU           | Email content only                                       |
| Paddle                    | Billing and subscriptions | Billing, tax, invoice, and payment metadata         | US / EU / UK | Billing data only                                        |
| Infomaniak                | Swiss AI models           | Live prompts and responses                          | Switzerland  | Yes, for live AI requests                                |
| Requesty                  | AI gateway                | Live prompts, responses, model metadata             | EU / UK      | Yes, for live AI requests                                |
| AI providers via Requesty | AI responses              | Live prompts and responses                          | EU           | Yes, for live AI requests                                |
| Plausible                 | Analytics, if enabled     | Aggregate usage events                              | EU           | No chat content                                          |

We require AI providers used with Cognos not to use Cognos user data for model training. Exact
retention and routing terms depend on the provider and selected privacy tier. We use contractual
safeguards where required, including data processing agreements and international transfer
protections.

## Encryption and security

Cognos uses client-side encryption for stored chat data.

In practical terms:

- stored chat history is encrypted at rest
- stored files and attachments are encrypted at rest
- conversation titles, summaries, memory, personas, attachment manifests, artifacts, and redaction
  mappings are encrypted at rest
- your Account Key is generated client-side and is not sent to Cognos servers
- private keys are encrypted client-side before backup
- conversation and file keys are wrapped or sealed for authorised users
- live AI requests are processed in plaintext so the AI can answer

We also use security measures such as:

- TLS in transit
- access controls
- route authorisation
- MFA support
- rate limits
- password lockout
- hardened containers
- firewall controls
- backups
- operational monitoring

Cognos staff should not be able to read stored chat content from the database. Staff access to
production systems is restricted. Staff are not permitted to inspect plaintext live request flows
except where strictly necessary and authorised for security or operational reasons.

Operational incident response and production-access procedures are maintained separately from this
public policy and are reviewed before production access is granted.

## What we do not do

We do not:

- sell your personal data
- share your personal data for advertising
- use your chats to train Cognos models
- intentionally log prompts or AI completions
- store full payment card details
- use advertising pixels
- use session replay, heatmaps, or keystroke logging
- scan encrypted stored chat history for advertising or profiling

## Sharing with vendors

We use service providers to run Cognos. These vendors may process personal data only as needed to
provide their services.

Repository-supported service integrations include:

- Hetzner, for app/backend hosting
- Bunny.net, for CDN/DNS
- BorgBase, for backups
- Scaleway, for transactional email
- Paddle, for payments, subscriptions, tax, and invoices
- Infomaniak, for Swiss AI infrastructure
- Requesty, for AI gateway services
- Ghost, for marketing site infrastructure
- GitHub, for development infrastructure
- Grafana Alloy or related tooling, for server monitoring
- Plausible, when enabled in the deployed environment, for cookieless aggregate analytics

Some providers may process data outside Switzerland, the EU, or the EEA. Where required, we use
appropriate safeguards such as data processing agreements and standard contractual clauses.

## International transfers

Cognos is operated by a Swiss company. Core app/backend hosting is currently on Hetzner
infrastructure in Falkenstein, Germany. The frontend may be served through Hetzner and Bunny.net.

Depending on your selected privacy tier, AI provider, billing interactions, email delivery, CDN
routing, support, or infrastructure services, your data may be processed in other countries.

Where required, we use contractual and legal safeguards for international transfers.

## Cookies and local storage

Cognos uses local storage and similar technologies for essential app functionality and preferences,
such as:

- language
- theme
- encrypted vault-session data
- authentication state

Paddle may use its own cookies or storage during checkout.

If Plausible analytics is enabled, it is intended to be cookieless.

We do not currently use Google Analytics, PostHog, Meta Pixel, LinkedIn Ads, Sentry, or advertising
cookies.

## Public sharing

Cognos supports public chat sharing.

If you choose to make a chat public or share it through a public link, people with access to that
link may be able to view the shared content. Only share conversations you are comfortable
disclosing.

## Sensitive data

Cognos is designed for private questions, but you should avoid adding unnecessary sensitive personal
data, confidential business data, health data, financial data, government IDs, or secrets.

Encryption and redaction reduce exposure, but they do not eliminate all risk. Live AI requests still
require plaintext processing by Cognos backend systems and the selected AI provider.

## Data retention

We keep data only as long as needed for the purposes described in this policy.

Current retention approach:

- account data is kept while your account exists
- chat data is kept until you delete it, it expires, or your account is deleted
- deleted ordinary records are snapshotted for 30 days in a deleted-record table
- key material and user attachment records are excluded from that 30-day deleted-record snapshot
- removed user attachments are hard-deleted
- financial records may be detached from your account and retained as required for accounting, tax,
  or legal purposes
- backups follow a rotation of hourly, daily, weekly, monthly, and yearly snapshots
- yearly backups may be kept for up to 10 years

Operational logs exclude prompts, completions, message content, and encryption keys. Support,
security, billing, tax, and accounting records are retained only for their operational or legal
purpose, then deleted or anonymised. The production retention settings and deletion jobs must match
the published policy before launch and after every retention change.

## Account deletion

You can delete your account, subject to any steps needed to cancel an active paid plan first.

Account deletion removes user-owned:

- conversations
- messages
- keys
- projects, where applicable
- personas
- preferences
- vault sessions

Financial records may be retained in detached form where required for legal, tax, accounting,
refund, fraud-prevention, or compliance reasons.

## Your choices and rights

Depending on where you live, you may have rights to:

- access your personal data
- correct inaccurate data
- delete your data
- export your data
- object to certain processing
- restrict certain processing
- withdraw consent
- complain to a data protection authority

Cognos supports browser-side export for conversations and data. You can also delete conversations
and manage account settings in the app.

To make a privacy request, email **[support@cognos.io](mailto:support@cognos.io)**.

We may need to verify your identity before fulfilling a request.

## Emails

We send transactional emails such as:

- account verification
- password reset
- authentication and security messages
- billing and subscription messages
- support replies

Any marketing email requires an applicable lawful basis and includes a way to opt out. Transactional
account, security, and billing messages are not marketing emails.

## Law enforcement and legal requests

We may disclose information if legally required.

If we receive a valid legal request for stored chat content, Cognos can only provide the encrypted
content and metadata it has. Cognos cannot decrypt stored chat history from storage without the
user’s Account Key and relevant keys.

Live AI request processing and metadata are different from encrypted stored history and may be
subject to normal operational and legal processes.

## Children

Cognos is not intended for children under 16. If you believe a child has used Cognos in violation of
this policy, contact us at **[support@cognos.io](mailto:support@cognos.io)**.

## Changes to this policy

We may update this policy as Cognos changes or as legal requirements evolve.

If changes are material, we will provide reasonable notice, such as through the app or by email.
