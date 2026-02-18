import json
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

HOST = "127.0.0.1"
PORT = 3000
BASE_DIR = Path(__file__).resolve().parent

RIJKSOVERHEID_RSS = "https://feeds.rijksoverheid.nl/onderwerpen/duurzame-energie/documenten.rss"
TWEEDEKAMER_ODATA = "https://gegevensmagazijn.tweedekamer.nl/OData/v4/2.0/Activiteit"

ENERGY_KEYWORDS = [
    "energie",
    "klimaat",
    "duurzaam",
    "waterstof",
    "elektriciteit",
    "stroom",
    "gas",
    "co2",
    "emissie",
    "netcongestie",
    "wind",
    "zon",
    "warmte",
    "kernenergie",
]


def utc_now():
    return datetime.now(timezone.utc)


def start_of_today_utc():
    now = utc_now()
    return datetime(now.year, now.month, now.day, tzinfo=timezone.utc)


def start_of_last_7_days_utc():
    return start_of_today_utc() - timedelta(days=6)


def strip_html(text):
    if not text:
        return ""
    no_tags = re.sub(r"<[^>]+>", "", text)
    return unescape(no_tags).strip()


def fetch_text(url):
    req = Request(url, headers={"User-Agent": "energy-dashboard/1.0", "Accept": "*/*"})
    with urlopen(req, timeout=20) as response:
        return response.read().decode("utf-8", "ignore")


def fetch_json(url):
    req = Request(url, headers={"User-Agent": "energy-dashboard/1.0", "Accept": "application/json"})
    with urlopen(req, timeout=20) as response:
        return json.loads(response.read().decode("utf-8", "ignore"))


def parse_rss_items(xml_text):
    root = ET.fromstring(xml_text)
    items = []
    for item in root.findall("./channel/item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        description = strip_html(item.findtext("description") or "")
        pub_date_raw = (item.findtext("pubDate") or "").strip()
        pub_iso = None

        if pub_date_raw:
            try:
                pub_dt = parsedate_to_datetime(pub_date_raw)
                if pub_dt.tzinfo is None:
                    pub_dt = pub_dt.replace(tzinfo=timezone.utc)
                pub_iso = pub_dt.astimezone(timezone.utc).isoformat()
            except Exception:
                pub_iso = None

        items.append(
            {
                "title": title,
                "link": link,
                "description": description,
                "pubDate": pub_iso,
            }
        )
    return items


def in_last_7_days(pub_iso):
    if not pub_iso:
        return False
    try:
        dt = datetime.fromisoformat(pub_iso.replace("Z", "+00:00"))
    except ValueError:
        return False

    start = start_of_last_7_days_utc()
    return dt >= start


def get_rijksoverheid_publicaties():
    xml = fetch_text(RIJKSOVERHEID_RSS)
    all_items = parse_rss_items(xml)
    items = [item for item in all_items if in_last_7_days(item.get("pubDate"))]
    items.sort(key=lambda item: item.get("pubDate") or "", reverse=True)
    return items[:25]


def has_energy_keyword(text):
    normalized = (text or "").lower()
    return any(keyword in normalized for keyword in ENERGY_KEYWORDS)


def to_tweedekamer_url(nummer, soort):
    if not nummer:
        return "https://www.tweedekamer.nl/debat_en_vergadering"

    kind = (soort or "").lower()
    if "plenair" in kind or "stemmingen" in kind or "vragenuur" in kind:
        return (
            "https://www.tweedekamer.nl/debat_en_vergadering/"
            f"plenaire_vergaderingen/details/activiteit?id={nummer}"
        )

    return (
        "https://www.tweedekamer.nl/debat_en_vergadering/"
        f"commissievergaderingen/details?id={nummer}"
    )


def get_tweedekamer_debatten():
    start = start_of_today_utc().strftime("%Y-%m-%dT00:00:00Z")
    params = {
        "$select": "Onderwerp,Soort,Datum,Aanvangstijd,Locatie,Nummer,Status,Kamer",
        "$filter": f"Verwijderd eq false and Status eq 'Gepland' and Kamer eq 'Tweede Kamer' and Datum ge {start}",
        "$orderby": "Datum asc",
        "$top": "200",
    }
    url = f"{TWEEDEKAMER_ODATA}?{urlencode(params)}"
    data = fetch_json(url)
    value = data.get("value", []) if isinstance(data, dict) else []

    filtered = []
    for item in value:
        subject = item.get("Onderwerp") or ""
        kind = item.get("Soort") or ""
        haystack = f"{subject} {kind}"
        if not has_energy_keyword(haystack):
            continue

        filtered.append(
            {
                "onderwerp": subject or "(zonder onderwerp)",
                "soort": kind,
                "datum": item.get("Datum"),
                "aanvangstijd": item.get("Aanvangstijd"),
                "locatie": item.get("Locatie") or "",
                "nummer": item.get("Nummer") or "",
                "url": to_tweedekamer_url(item.get("Nummer") or "", kind),
            }
        )

    return filtered[:20]


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, filename, content_type):
        file_path = BASE_DIR / filename
        if not file_path.exists():
            self.send_error(404, "Bestand niet gevonden")
            return

        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/":
            return self._send_file("index.html", "text/html; charset=utf-8")
        if path == "/styles.css":
            return self._send_file("styles.css", "text/css; charset=utf-8")
        if path == "/app.js":
            return self._send_file("app.js", "application/javascript; charset=utf-8")

        if path == "/api/rijksoverheid":
            try:
                items = get_rijksoverheid_publicaties()
                return self._send_json(
                    200,
                    {
                        "range": "last7days",
                        "items": items,
                        "updatedAt": utc_now().isoformat(),
                    },
                )
            except (URLError, HTTPError, ET.ParseError, TimeoutError, ValueError) as exc:
                return self._send_json(
                    502,
                    {
                        "error": "Kon publicaties van Rijksoverheid niet ophalen.",
                        "detail": str(exc),
                    },
                )

        if path == "/api/debatten":
            try:
                items = get_tweedekamer_debatten()
                return self._send_json(200, {"items": items, "updatedAt": utc_now().isoformat()})
            except (URLError, HTTPError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
                return self._send_json(
                    502,
                    {
                        "error": "Kon debatten van Tweede Kamer niet ophalen.",
                        "detail": str(exc),
                    },
                )

        self.send_error(404, "Pagina niet gevonden")


def main():
    httpd = HTTPServer((HOST, PORT), Handler)
    print(f"Server draait op http://{HOST}:{PORT}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
