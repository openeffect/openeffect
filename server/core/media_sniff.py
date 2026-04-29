"""Magic-byte verification for uploaded media. Catches Content-Type
spoofing before any bytes hit disk - a client could otherwise upload
HTML claiming `Content-Type: image/png`, and `FileResponse` would
later serve it inline with a media-type inferred from the extension."""

# Bytes needed to verify any of the signatures below.
SNIFF_SIZE = 16


def sniff_matches(head: bytes, claimed: str) -> bool:
    """Return True iff `head` (first SNIFF_SIZE bytes of the upload)
    starts with the magic signature for `claimed` (the Content-Type
    header). Unknown / unsupported types return False."""
    if claimed == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if claimed == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if claimed == "image/gif":
        return head.startswith(b"GIF87a") or head.startswith(b"GIF89a")
    if claimed == "image/webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if claimed == "video/mp4":
        return head[4:8] == b"ftyp"
    if claimed == "video/webm":
        return head.startswith(b"\x1a\x45\xdf\xa3")
    return False
