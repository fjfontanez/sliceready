# ADMesh — Corresponding Source Offer

`admesh.wasm` and `admesh.mjs` in this directory are compiled from
[ADMesh](https://github.com/admesh/admesh), licensed under the GNU General
Public License v2 — see `ADMESH-LICENSE`.

**Pinned source commit:** see `ADMESH-SOURCE-COMMIT.txt` in this directory.

To obtain or rebuild the exact corresponding source:

```bash
git clone https://github.com/admesh/admesh admesh-src
git -C admesh-src checkout "$(cat ADMESH-SOURCE-COMMIT.txt)"
./build.sh   # builds admesh.wasm/admesh.mjs from admesh-src via Docker; see build.sh
```
