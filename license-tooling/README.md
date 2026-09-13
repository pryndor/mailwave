# License tooling (internal, not shipped in the app)

Issues signed Pro license tokens. `electron/license.js` verifies them fully
offline — no server, no phone-home — using the public half of an Ed25519
keypair baked into that file.

## First-time setup (already done for this project)

`generate-keypair.js` was already run once. `public_key.pem` is copied into
the `PUBLIC_KEY_PEM` constant in `electron/license.js`. **Do not re-run it** —
that generates a new keypair and invalidates every license already issued to
customers, since the app only trusts one public key at a time.

`private_key.pem` is gitignored and must never be committed or shipped
inside the built app. Back it up somewhere safe outside this repo — losing
it means you can never issue another valid license without rotating keys
and re-issuing everyone.

## Issuing a license after a sale

```bash
node generate-license.js customer@email.com 1   # 1 = years
```

Paste the printed token to the customer, or automate this from a Lemon
Squeezy/Paddle purchase webhook later. The token encodes email + plan +
expiry and is meaningless without the matching private key to forge.

## How verification works (electron/license.js)

- Token = `base64url(JSON payload) + "." + base64url(Ed25519 signature)`
- Signature is checked against the embedded public key — works with zero
  internet connection.
- Expiry has a 30-day grace period (`GRACE_DAYS`) after which Pro features
  turn back off, but the app and Free-tier features never lock up — see
  `getStatus()`.
- Subscriber count is unlimited on every tier. Pro unlocks the automation
  bridge, Smart Schedule, FTP/SFTP sync, and Brevo stats (see the
  `license.isPro()` calls in those modules).
