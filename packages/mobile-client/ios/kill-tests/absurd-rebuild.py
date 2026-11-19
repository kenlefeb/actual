# Fork-only (sc-5393). absurd-rebuild.py <IndexedDB.sqlite3 copy> <out.sqlite>: rebuilds a
# budget's SQLite file from absurd-sql's blocks in WebKit's IndexedDB (key: block number as a
# double; value: a serialized ArrayBuffer behind a 13-byte header; key -1 holds the file's
# size), cut to the stored size. Prints what it saw. WebKit's own file can't be opened with
# the sqlite3 CLI's queries on keys (its IDBKEY collation), so this reads rows in table order.
import sqlite3
import struct
import sys

src, out = sys.argv[1], sys.argv[2]
con = sqlite3.connect(src)
con.text_factory = bytes
blocks, size = {}, None
for key, value in con.execute("select key, value from Records"):
    assert key[:2] == b"\x00\x20", key[:2]
    block = struct.unpack("<d", key[2:10])[0]
    if block < 0:
        assert b"size" in value
        size = struct.unpack("<i", value[value.index(b"size") + 5 :][:4])[0]
        continue
    assert value[4] == 0x15, value[:13].hex()
    length = struct.unpack("<Q", value[5:13])[0]
    blocks[int(block) * 4096] = value[13 : 13 + length]
assert size is not None, "no size record"
print(f"size {size}, blocks {len(blocks)}, beyond size {sum(1 for o in blocks if o >= size)}")
missing = [o for o in range(0, size, 4096) if o not in blocks]
print(f"missing blocks below size: {missing}")
data = bytearray(size)
for offset, block in blocks.items():
    if offset < size:
        data[offset : offset + len(block)] = block
open(out, "wb").write(data)
assert data.startswith(b"SQLite format 3\x00"), "bad header"
print("pages in header", struct.unpack(">I", data[28:32])[0])
