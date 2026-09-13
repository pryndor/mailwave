# Razorpay webhook -> MailWave Pro license issuance, running on GoDaddy
# cPanel via "Setup Python App" (Passenger/WSGI) instead of Vercel.
#
# Verified cross-language compatible with electron/license.js: Ed25519 is a
# deterministic standard algorithm (RFC 8032) -- a signature made here with
# the same private key verifies correctly in the desktop app's Node.js
# crypto.verify(), no format conversion needed since both read the same
# PEM private key file.
#
# Required environment variables (set via cPanel's Python App "Environment
# Variables" panel, never committed):
#   RAZORPAY_WEBHOOK_SECRET  -- from Razorpay Dashboard > Webhooks
#   LICENSE_PRIVATE_KEY_PEM  -- contents of license-tooling/private_key.pem
#   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL -- your Zoho SMTP creds

import base64
import hashlib
import hmac
import json
import os
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from cryptography.hazmat.primitives.serialization import load_pem_private_key
from flask import Flask, request, jsonify

app = Flask(__name__)


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def verify_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    if not signature_header:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature_header, expected)


def sign_license(email: str, years: int = 1):
    private_key = load_pem_private_key(
        os.environ['LICENSE_PRIVATE_KEY_PEM'].encode(), password=None
    )
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=years * 365)
    payload = {
        'email': email,
        'plan': 'pro',
        'issued': now.strftime('%Y-%m-%dT%H:%M:%S.') + f'{now.microsecond // 1000:03d}Z',
        'expires': expires.strftime('%Y-%m-%dT%H:%M:%S.') + f'{expires.microsecond // 1000:03d}Z',
    }
    # Compact separators to match JS's default JSON.stringify (no spaces) --
    # doesn't have to match byte-for-byte since each side re-parses its own
    # payload independently, but keeping it tidy.
    payload_json = json.dumps(payload, separators=(',', ':')).encode()
    payload_b64 = b64url_encode(payload_json)
    signature = private_key.sign(payload_b64.encode())
    token = f'{payload_b64}.{b64url_encode(signature)}'
    return token, payload['expires']


def email_license(to_email: str, token: str, expires_iso: str):
    expires_dt = datetime.fromisoformat(expires_iso.replace('Z', '+00:00'))
    expires_label = expires_dt.strftime('%B %d, %Y')

    msg = EmailMessage()
    msg['Subject'] = 'Your MailWave Pro license key'
    msg['From'] = f"MailWave <{os.environ['FROM_EMAIL']}>"
    msg['To'] = to_email
    msg.set_content(
        'Thanks for subscribing to MailWave Pro!\n\n'
        f'Your license key (valid until {expires_label}):\n\n'
        f'{token}\n\n'
        'To activate: open MailWave -> Settings -> License -> paste this key -> Activate.\n\n'
        'Keep this email -- you can re-activate with the same key on a new machine.\n'
        'Questions? Just reply to this email.'
    )

    with smtplib.SMTP_SSL(os.environ['SMTP_HOST'], int(os.environ.get('SMTP_PORT', 465))) as smtp:
        smtp.login(os.environ['SMTP_USER'], os.environ['SMTP_PASS'])
        smtp.send_message(msg)


@app.route('/api/razorpay-webhook', methods=['POST'])
def razorpay_webhook():
    raw_body = request.get_data()

    signature_header = request.headers.get('X-Razorpay-Signature', '')
    if not verify_signature(raw_body, signature_header, os.environ['RAZORPAY_WEBHOOK_SECRET']):
        return jsonify({'error': 'invalid signature'}), 400

    try:
        event = json.loads(raw_body)
    except ValueError:
        return jsonify({'error': 'invalid JSON'}), 400

    if event.get('event') not in ('subscription.charged', 'subscription.activated'):
        return jsonify({'ok': True, 'ignored': event.get('event')}), 200

    payload = event.get('payload', {})
    email = (
        payload.get('payment', {}).get('entity', {}).get('email')
        or payload.get('subscription', {}).get('entity', {}).get('notes', {}).get('email')
    )
    if not email:
        return jsonify({'error': 'no customer email in webhook payload'}), 400

    try:
        token, expires = sign_license(email, 1)
        email_license(email, token, expires)
        return jsonify({'ok': True}), 200
    except Exception as err:  # noqa: BLE001 -- report to Razorpay so it retries, log for us
        app.logger.error('license issuance failed: %s', err)
        return jsonify({'error': str(err)}), 500


if __name__ == '__main__':
    # Local testing only -- cPanel runs this via passenger_wsgi.py instead.
    app.run(port=5000, debug=True)
