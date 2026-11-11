"""Dry-run the full Paper Trail flow without WhatsApp/Twilio.

Serves the fake docs on a local port, posts Twilio-shaped webhooks to the route,
and prints the replies the route writes to data/dryrun.log.
Fake +1555 numbers always run in dry-run mode: replies go to data/dryrun.log, never to WhatsApp.
If TWILIO_AUTH_TOKEN is set, requests are signed so the live route accepts them.
Usage: python3 test/demo.py [route_url] [--short] [--from=whatsapp:+1555...]
Seed a demo batch: run --short with 10 different --from numbers, then `cd chain && bun anchor.ts --now`.
"""
import base64, hashlib, hmac, http.server, json, os, sys, threading, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
URL = ARGS[0] if ARGS else "http://localhost:3099/api/papertrail"
PUBLIC_URL = "https://kikib.zo.space/api/papertrail"
LOG = ROOT.parent / "data" / "dryrun.log"
PORT = 8765
FROM = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--from=")), "whatsapp:+15550000001")

handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(ROOT / "fake-docs"), **k)
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever, daemon=True).start()

STEPS = [
    ("text", "hola"),
    ("photo", "notice-to-appear.jpg"),
    ("text", "sobre azul, cajón de la cocina"),
    ("photo", "passport.jpg"),
    ("text", "me arrestaron en 2019"),
    ("text", "carpeta roja, armario"),
    ("photo", "hearing-notice.jpg"),
    ("text", "carpeta roja"),
    ("photo", "pay-stub.jpg"),
    ("text", "caja de zapatos"),
    ("text", "VISITA"),
    ("text", "CAMBA Legal, hablé con Ana"),
    ("text", "hoy"),
    ("text", "traer declaraciones de impuestos antes del 20 de noviembre"),
    ("text", "ESTAFA"),
    ("text", "LISTA"),
    ("text", "BRIEF"),
    ("text", "PROOF"),
]
if "--short" in sys.argv:  # one document then BRIEF: produces one TEE receipt for the impact batch
    DOC = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--doc=")), "passport.jpg")
    STEPS = [("text", "hola"), ("photo", DOC), ("text", "carpeta roja"), ("text", "BRIEF")]


def post(params):
    params = {"From": FROM, "To": "whatsapp:+14155238886", "MessageSid": "SMtest", **params}
    headers = {}
    token = os.environ.get("TWILIO_AUTH_TOKEN")
    if token:  # sign like Twilio does, so the live route accepts it. +1555 numbers never get a real WhatsApp reply.
        payload = PUBLIC_URL + "".join(k + params[k] for k in sorted(params))
        headers["X-Twilio-Signature"] = base64.b64encode(hmac.new(token.encode(), payload.encode(), hashlib.sha1).digest()).decode()
    data = urllib.parse.urlencode(params).encode()
    urllib.request.urlopen(urllib.request.Request(URL, data=data, headers=headers), timeout=30).read()


def wait_quiet(start, quiet=6, cap=150):
    t0, last, size = time.time(), time.time(), -1
    while time.time() - t0 < cap:
        cur = LOG.stat().st_size if LOG.exists() else 0
        if cur != size:
            size, last = cur, time.time()
        if cur > start and time.time() - last > quiet:
            return
        time.sleep(1)


for kind, val in STEPS:
    start = LOG.stat().st_size if LOG.exists() else 0
    print(f"\n>>> USER: {'[photo] ' + val if kind == 'photo' else val}")
    t = time.time()
    if kind == "photo":
        post({"NumMedia": "1", "MediaUrl0": f"http://127.0.0.1:{PORT}/{val}", "MediaContentType0": "image/jpeg", "Body": ""})
    else:
        post({"NumMedia": "0", "Body": val})
    wait_quiet(start)
    with open(LOG) as f:
        f.seek(start)
        print(f.read().replace(f"--- to {FROM} ---\n", "<<< PAPER TRAIL:\n").rstrip())
    print(f"({time.time() - t:.0f}s)")
