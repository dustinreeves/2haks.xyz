"""A small PNG writer, so the server needs no image library."""

import struct
import zlib


def _chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def encode_png(pixels: list[str | None], size: int, scale: int = 1) -> bytes:
    """Turn a size*size list of '#rrggbb' (or None for see-through) into an RGBA PNG.

    Each drawing pixel becomes a scale*scale block, so a 20x20 drawing at
    scale 10 is a 200x200 image.
    """
    rows = []
    for y in range(size):
        line = bytearray()
        for x in range(size):
            p = pixels[y * size + x]
            rgba = bytes.fromhex(p[1:]) + b"\xff" if p else b"\x00\x00\x00\x00"
            line += rgba * scale
        # Every PNG row starts with a filter byte; 0 means "no filter".
        rows.extend([b"\x00" + bytes(line)] * scale)

    width = size * scale
    header = struct.pack(">IIBBBBB", width, width, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
        + _chunk(b"IEND", b"")
    )
