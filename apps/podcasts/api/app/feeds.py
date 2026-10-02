"""Turn a podcast RSS feed into plain JSON.

Episodes keep the creator's own audio URL, so nothing is downloaded or stored here
except the text of the feed. Descriptions are converted from HTML to plain text, so the
page never has to trust HTML from a feed.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from xml.etree.ElementTree import Element, ParseError

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import fromstring

MAX_EPISODES = 300
MAX_TEXT = 3000
AUDIO_EXT = re.compile(r"\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|$)", re.I)

NAMESPACES = {
    "itunes": {"http://www.itunes.com/dtds/podcast-1.0.dtd"},
    "content": {"http://purl.org/rss/1.0/modules/content/"},
    "": {""},
}


class FeedError(Exception):
    pass


def _split(tag: str) -> tuple[str, str]:
    if tag.startswith("{"):
        ns, _, local = tag[1:].partition("}")
        return ns.lower(), local
    return "", tag


def _child(el: Element, name: str) -> Element | None:
    prefix, _, local = name.rpartition(":")
    wanted = NAMESPACES[prefix]
    for c in el:
        if not isinstance(c.tag, str):
            continue
        ns, loc = _split(c.tag)
        if loc == local and ns in wanted:
            return c
    return None


def _text(el: Element, *names: str) -> str:
    for name in names:
        c = _child(el, name)
        if c is not None:
            t = "".join(c.itertext()).strip()
            if t:
                return t
    return ""


class _TextOnly(HTMLParser):
    BLOCKS = {"p", "div", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "tr", "table", "hr"}
    SKIP = {"script", "style"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skipping = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skipping += 1
        elif tag == "br":
            self.out.append("\n")
        elif tag == "li":
            self.out.append("\n• ")
        elif tag in self.BLOCKS:
            self.out.append("\n\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skipping = max(0, self.skipping - 1)
        elif tag in self.BLOCKS:
            self.out.append("\n\n")

    def handle_data(self, data):
        if not self.skipping:
            self.out.append(data)


def html_to_text(s: str, limit: int = MAX_TEXT) -> str:
    if "<" in s:
        p = _TextOnly()
        p.feed(s)
        p.close()
        s = "".join(p.out)
    else:
        s = unescape(s)
    s = re.sub(r"[ \t\r\f\v ]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    if len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0] + "…"
    return s


def parse_duration(s: str) -> int | None:
    s = s.strip()
    if not s:
        return None
    try:
        if ":" in s:
            total = 0
            for part in s.split(":"):
                total = total * 60 + int(float(part or 0))
            return total or None
        return int(float(s)) or None
    except ValueError:
        return None


def parse_date(s: str) -> datetime | None:
    s = s.strip()
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def _web_url(u: str) -> str:
    u = u.strip()
    return u if u.lower().startswith(("https://", "http://")) else ""


def _image(el: Element) -> str:
    img = _child(el, "itunes:image")
    if img is not None and _web_url(img.get("href", "")):
        return _web_url(img.get("href", ""))
    plain = _child(el, "image")
    if plain is not None:
        return _web_url(_text(plain, "url"))
    return ""


def _explicit(el: Element) -> bool | None:
    v = _text(el, "itunes:explicit").lower()
    if v in ("yes", "true", "explicit"):
        return True
    if v in ("no", "false", "clean", "notexplicit"):
        return False
    return None


def _int(s: str) -> int | None:
    try:
        return int(s.strip())
    except ValueError:
        return None


def _episode(item: Element) -> dict | None:
    enc = _child(item, "enclosure")
    if enc is None:
        return None
    audio = _web_url(enc.get("url", ""))
    kind = (enc.get("type") or "").lower()
    if not audio or not (kind.startswith("audio/") or (not kind and AUDIO_EXT.search(audio))):
        return None
    published = parse_date(_text(item, "pubDate"))
    guid = _text(item, "guid") or audio
    title = html_to_text(_text(item, "title", "itunes:title"), 300) or "Untitled episode"
    notes = _text(item, "content:encoded", "description", "itunes:summary")
    return {
        "id": hashlib.sha1(guid.encode()).hexdigest()[:12],
        "title": title,
        "published": published.strftime("%Y-%m-%dT%H:%M:%SZ") if published else None,
        "audio": audio,
        "type": kind or "audio/mpeg",
        "size": _int(enc.get("length") or "") or None,
        "duration": parse_duration(_text(item, "itunes:duration")),
        "description": html_to_text(notes),
        "image": _image(item),
        "season": _int(_text(item, "itunes:season")),
        "episode": _int(_text(item, "itunes:episode")),
        "explicit": _explicit(item),
        "link": _web_url(_text(item, "link")),
    }


def parse_feed(xml: bytes, max_episodes: int = MAX_EPISODES) -> dict:
    xml = xml.lstrip(b"\xef\xbb\xbf \t\r\n")
    try:
        root = fromstring(xml)
    except (ParseError, DefusedXmlException, ValueError):
        raise FeedError("that isn't a readable RSS feed") from None
    channel = _child(root, "channel") if _split(root.tag)[1] == "rss" else None
    if channel is None:
        raise FeedError("that isn't a podcast RSS feed")

    episodes, seen = [], set()
    for item in channel:
        if not isinstance(item.tag, str) or _split(item.tag)[1] != "item":
            continue
        ep = _episode(item)
        if ep and ep["id"] not in seen:
            seen.add(ep["id"])
            episodes.append(ep)
    # Newest first; undated episodes keep feed order at the end.
    episodes.sort(key=lambda e: e["published"] or "", reverse=True)

    return {
        "name": html_to_text(_text(channel, "title", "itunes:title"), 300),
        "author": html_to_text(_text(channel, "itunes:author", "author"), 300),
        "description": html_to_text(_text(channel, "itunes:summary", "description")),
        "artwork": _image(channel),
        "link": _web_url(_text(channel, "link")),
        "explicit": _explicit(channel),
        "episode_count": len(episodes),
        "episodes": episodes[:max_episodes],
    }
