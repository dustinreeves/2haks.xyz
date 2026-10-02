"""Careful HTTP GETs to other people's servers (Apple's charts and podcast RSS feeds).

Only public hosts are allowed (no localhost, private or link-local addresses, checked on
every redirect), responses have a size cap and a deadline, and only a few fetches run at
once. Audio files are never fetched: the browser streams those from the creators.
"""

from __future__ import annotations

import ipaddress
import socket
import threading
import time
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import httpx

USER_AGENT = "PodPile/1.0 (+https://podcasts.2haks.xyz)"
MAX_BYTES = 30 * 1024 * 1024  # some long-running shows have 20MB+ feeds
DEADLINE = 30.0  # seconds for the whole fetch, redirects included
MAX_REDIRECTS = 6
ALLOWED_PORTS = {None, 80, 443, 8080, 8443}


class FetchError(Exception):
    pass


@dataclass
class Fetched:
    status: int
    body: bytes = b""
    headers: dict = field(default_factory=dict)
    url: str = ""


def check_url(url: str) -> None:
    """Refuse anything that isn't http(s) to a public address."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise FetchError("only http and https links can be fetched")
    try:
        port = parts.port
    except ValueError:
        raise FetchError("bad port in link") from None
    if port not in ALLOWED_PORTS:
        raise FetchError("that port isn't allowed")
    infos = None
    for attempt in range(3):  # Docker's resolver now and then answers "no address"
        try:
            infos = socket.getaddrinfo(parts.hostname, port or 443, socket.AF_INET, proto=socket.IPPROTO_TCP)
            break
        except UnicodeError:
            break
        except socket.gaierror:
            time.sleep(0.2 * (attempt + 1))
    if not infos:
        raise FetchError(f"can't find {parts.hostname}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if not ip.is_global:
            raise FetchError(f"{parts.hostname} isn't a public address")


class Upstream:
    def __init__(self, timeout: float = 15.0, max_bytes: int = MAX_BYTES, parallel: int = 6):
        self.client = httpx.Client(
            # IPv4 only: the container has no IPv6 route. retries= re-tries failed connects.
            transport=httpx.HTTPTransport(local_address="0.0.0.0", retries=2),
            timeout=httpx.Timeout(timeout, connect=5.0),
            follow_redirects=False,
            headers={"User-Agent": USER_AGENT},
        )
        self.max_bytes = max_bytes
        self.slots = threading.BoundedSemaphore(parallel)

    def get(self, url: str, headers: dict | None = None) -> Fetched:
        """GET a URL, following redirects by hand so each hop is checked.

        Returns status 200 with the body, or 304 when the conditional headers matched.
        """
        start = time.monotonic()
        with self.slots:
            for _ in range(MAX_REDIRECTS + 1):
                check_url(url)
                host = urlsplit(url).hostname
                try:
                    with self.client.stream("GET", url, headers=headers or {}) as res:
                        if res.status_code in (301, 302, 303, 307, 308):
                            location = res.headers.get("location")
                            if not location:
                                raise FetchError(f"{host} sent a redirect with no address")
                            url = urljoin(url, location)
                            continue
                        if res.status_code == 304:
                            return Fetched(304, b"", dict(res.headers), url)
                        if res.status_code != 200:
                            raise FetchError(f"{host} answered {res.status_code}")
                        body = bytearray()
                        for chunk in res.iter_bytes():
                            body += chunk
                            if len(body) > self.max_bytes:
                                raise FetchError("that feed is too big")
                            if time.monotonic() - start > DEADLINE:
                                raise FetchError(f"{host} is too slow")
                        return Fetched(200, bytes(body), dict(res.headers), url)
                except httpx.HTTPError as e:
                    raise FetchError(f"couldn't reach {host} ({type(e).__name__})") from None
            raise FetchError("too many redirects")
