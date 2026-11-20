"""Fetch the squat clips of the Mendeley multi-view fitness dataset, without downloading the whole 3.1 GB archive.

"A Multi-View Raw Video Dataset of Seven Fitness Exercises with Good/Bad Form Labels" (Mendeley Data,
DOI 10.17632/kgbb3yn47p.3, CC BY 4.0, 2026): 26 people filmed on smartphones in a gym from the front, the side and
diagonally, each clip labelled good or bad form. We use only the bodyweight squats: 150 clips, about 515 MB.

The archive is read with HTTP range requests, one clip at a time, into ~/jhealth-cache/datasets/mendeley_kgbb3yn47p/
as  <subject>_squat_<good|bad>_<front|side|diagonal>.mp4 . Safe to stop and restart (finished clips are skipped).

    ~/jhealth-cache/venv/bin/python -I fetch_mendeley_squats.py
"""
import io
import os
import ssl
import sys
import urllib.request
import zipfile

import certifi

URL = "https://data.mendeley.com/public-files/datasets/kgbb3yn47p/files/b878bcef-7bbe-4829-9f02-f4e9bb83ed55/file_downloaded"
OUT = os.path.expanduser("~/jhealth-cache/datasets/mendeley_kgbb3yn47p")
CTX = ssl.create_default_context(cafile=certifi.where())


class RangeFile(io.RawIOBase):
    """A read-only, seekable file over HTTP range requests."""

    def __init__(self, url):
        self.url, self.pos = url, 0
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "dataset-fetch"})
        with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
            self.size = int(r.headers["Content-Length"])

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}", "User-Agent": "dataset-fetch"})
        with urllib.request.urlopen(req, timeout=180, context=CTX) as r:
            data = r.read()
        self.pos += len(data)
        return data

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


def main():
    os.makedirs(OUT, exist_ok=True)
    z = zipfile.ZipFile(io.BufferedReader(RangeFile(URL), buffer_size=4 << 20))
    clips = [i for i in z.infolist() if not i.is_dir() and "/squat/" in i.filename.lower() and i.filename.lower().endswith(".mp4")]
    print(f"{len(clips)} squat clips, {sum(i.file_size for i in clips) / 1e6:.0f} MB", flush=True)
    done = 0
    for n, info in enumerate(sorted(clips, key=lambda i: i.filename), 1):
        name = os.path.basename(info.filename)                      # subject_001_squat_bad_front.mp4
        if not all(c.isalnum() or c in "._-" for c in name):       # never trust a path from an archive
            print("skipped odd name", repr(name)); continue
        path = os.path.join(OUT, name)
        if os.path.exists(path) and os.path.getsize(path) == info.file_size:
            done += 1; continue
        with z.open(info) as src, open(path + ".part", "wb") as dst:
            while chunk := src.read(1 << 20):
                dst.write(chunk)
        os.replace(path + ".part", path)
        done += 1
        if n % 10 == 0 or n == len(clips):
            print(f"  {n}/{len(clips)} fetched", flush=True)
    print(f"done: {done} clips in {OUT}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
