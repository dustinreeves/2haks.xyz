import json

import pytest
from fastapi.testclient import TestClient

from app.feeds import FeedError, html_to_text, parse_duration, parse_feed
from app.fetch import Fetched, FetchError, check_url
from app.main import create_app

FEED = b"""\xef\xbb\xbf
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Goofy Hour</title>
    <itunes:author>Dad &amp; Kid</itunes:author>
    <description><![CDATA[<p>Two people <b>talking</b>.</p><script>alert(1)</script>]]></description>
    <itunes:image href="https://example.com/art.jpg"/>
    <itunes:explicit>false</itunes:explicit>
    <item>
      <title>Episode 1</title>
      <guid>ep-1</guid>
      <pubDate>Mon, 28 Sep 2026 10:00:00 +0000</pubDate>
      <enclosure url="https://cdn.example.com/1.mp3" length="1234" type="audio/mpeg"/>
      <itunes:duration>1:02:03</itunes:duration>
      <content:encoded><![CDATA[Hello<br/>world <a href="https://x.y">link</a><ul><li>one</li></ul>]]></content:encoded>
    </item>
    <item>
      <title>Episode 2</title>
      <guid>ep-2</guid>
      <pubDate>Wed, 30 Sep 2026 10:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/2.m4a" type="audio/x-m4a"/>
      <itunes:duration>754</itunes:duration>
    </item>
    <item>
      <title>A video, skipped</title>
      <enclosure url="https://cdn.example.com/3.mp4" type="video/mp4"/>
    </item>
    <item>
      <title>Sneaky</title>
      <enclosure url="javascript:alert(1)" type="audio/mpeg"/>
    </item>
  </channel>
</rss>
"""

LOOKUP = {"resultCount": 1, "results": [{
    "kind": "podcast", "collectionId": 42, "collectionName": "Goofy Hour", "artistName": "Dad",
    "feedUrl": "https://feeds.example.com/goofy", "artworkUrl600": "https://img.example.com/600.jpg",
    "primaryGenreName": "Comedy", "collectionExplicitness": "notExplicit", "contentAdvisoryRating": "Clean",
    "trackCount": 2,
    "collectionViewUrl": "https://podcasts.apple.com/us/podcast/goofy/id42?uo=4",
}]}

CHART = {"feed": {"entry": [
    {"id": {"attributes": {"im:id": "42"}}, "im:name": {"label": "Goofy Hour"},
     "im:artist": {"label": "Dad"}, "im:image": [{"label": "https://img.example.com/55.jpg"}]},
]}}


class FakeUpstream:
    def __init__(self):
        self.calls = []
        self.fail = False
        self.feed_status = 200

    def get(self, url, headers=None):
        self.calls.append((url, headers or {}))
        if self.fail:
            raise FetchError("nope")
        if url.startswith("https://itunes.apple.com/lookup"):
            return Fetched(200, json.dumps(LOOKUP).encode(), {}, url)
        if "/rss/toppodcasts/" in url:
            return Fetched(200, json.dumps(CHART).encode(), {}, url)
        if url.startswith("https://itunes.apple.com/search"):
            return Fetched(200, json.dumps(LOOKUP).encode(), {}, url)
        if url == "https://feeds.example.com/goofy":
            if self.feed_status == 304:
                return Fetched(304, b"", {}, url)
            return Fetched(200, FEED, {"etag": '"v1"'}, url)
        raise FetchError("unexpected url " + url)


@pytest.fixture()
def up():
    return FakeUpstream()


@pytest.fixture()
def client(tmp_path, up):
    return TestClient(create_app(tmp_path / "cache.db", up, warm=False))


def test_parse_feed():
    f = parse_feed(FEED)
    assert f["name"] == "Goofy Hour"
    assert f["author"] == "Dad & Kid"
    assert f["description"] == "Two people talking."
    assert f["artwork"] == "https://example.com/art.jpg"
    assert [e["title"] for e in f["episodes"]] == ["Episode 2", "Episode 1"]
    one = f["episodes"][1]
    assert one["audio"] == "https://cdn.example.com/1.mp3"
    assert one["duration"] == 3723
    assert one["published"] == "2026-09-28T10:00:00Z"
    assert one["description"] == "Hello\nworld link\n\n• one"
    assert f["episodes"][0]["duration"] == 754


def test_bad_feeds_are_refused():
    with pytest.raises(FeedError):
        parse_feed(b"<html><body>hi</body></html>")
    with pytest.raises(FeedError):
        parse_feed(b"not xml at all")
    bomb = b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]><rss><channel>&b;</channel></rss>'
    with pytest.raises(FeedError):
        parse_feed(bomb)


def test_helpers():
    assert parse_duration("45:00") == 2700
    assert parse_duration("1800.5") == 1800
    assert parse_duration("soon") is None
    assert html_to_text("a &amp; b") == "a & b"
    assert html_to_text("x " * 5000).endswith("…")


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/feed", "http://localhost/feed", "http://10.0.0.5/x", "http://169.254.169.254/latest",
    "http://[::1]/x", "file:///etc/passwd", "ftp://example.com/x", "http://example.com:22/x",
])
def test_private_and_odd_urls_are_refused(url):
    with pytest.raises(FetchError):
        check_url(url)


def test_top_chart(client, up):
    r = client.get("/api/top")
    assert r.status_code == 200
    show = r.json()["shows"][0]
    assert show["id"] == "42" and show["rank"] == 1
    assert show["artwork"] == "https://img.example.com/600.jpg"
    assert show["apple_url"] == "https://podcasts.apple.com/us/podcast/goofy/id42"
    assert show["explicit"] is False
    calls = len(up.calls)
    client.get("/api/top")
    assert len(up.calls) == calls  # cached
    assert client.get("/api/top?genre=nope").status_code == 404


def test_explicit_flag_uses_advisory_rating():
    from app.apple import show_from_lookup

    r = {**LOOKUP["results"][0], "collectionExplicitness": "notExplicit", "contentAdvisoryRating": "Explicit"}
    assert show_from_lookup(r)["explicit"] is True


def test_podcast_page_uses_chart_lookup_and_caches_feed(client, up):
    client.get("/api/top")
    up.calls.clear()
    r = client.get("/api/podcasts/42")
    assert r.status_code == 200
    body = r.json()
    assert body["podcast"]["name"] == "Goofy Hour"
    assert len(body["episodes"]) == 2
    assert [u for u, _ in up.calls] == ["https://feeds.example.com/goofy"]
    client.get("/api/podcasts/42")
    assert len(up.calls) == 1


def test_feed_refresh_sends_etag_and_handles_304(client, up, monkeypatch):
    client.get("/api/podcasts/42")
    monkeypatch.setattr("app.main.FEED_TTL", -1)
    up.feed_status = 304
    r = client.get("/api/podcasts/42")
    assert r.status_code == 200 and len(r.json()["episodes"]) == 2
    assert up.calls[-1][1].get("If-None-Match") == '"v1"'


def test_stale_copy_is_served_when_creator_is_down(client, up, monkeypatch):
    client.get("/api/podcasts/42")
    monkeypatch.setattr("app.main.FEED_TTL", -1)
    up.fail = True
    r = client.get("/api/podcasts/42")
    assert r.status_code == 200 and r.json()["stale"] is True


def test_errors(client, up):
    assert client.get("/api/podcasts/../etc").status_code == 404
    assert client.get("/api/podcasts/abc").status_code == 404
    up.fail = True
    assert client.get("/api/podcasts/7").status_code == 502
    assert client.get("/api/search?q=a").status_code == 422


def test_search_and_rate_limit(client, up, monkeypatch):
    assert client.get("/api/search?q=goofy").json()["shows"][0]["id"] == "42"
    monkeypatch.setattr("app.main.PER_CLIENT", 1)
    assert client.get("/api/search?q=goofy").status_code == 200  # cached, not counted
    assert client.get("/api/search?q=other thing").status_code == 429


def test_warmer_fetches_top_feeds_once(tmp_path, up):
    from app.cache import Cache
    from app.main import Pods

    pods = Pods(Cache(tmp_path / "cache.db"), up)
    assert pods.warm_once(pause=0) == 1
    assert pods.warm_once(pause=0) == 0  # still fresh


def test_health_and_genres(client):
    assert client.get("/api/health").json()["status"] == "ok"
    ids = [g["id"] for g in client.get("/api/genres").json()["genres"]]
    assert ids[0] == "all" and "comedy" in ids
