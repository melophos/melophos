# Fonts

These files are self-hosted, so no page makes a request to a font service. Each font keeps its licence text beside it.
Nothing is subset except the music signs file, described below.

To change the typeface, replace the files here, update this table and change the
names in [`fonts.css`](fonts.css) and in `--font-sans` and `--font-mono` in [`../tokens.css`](../tokens.css). Run
`npm run fonts:metrics` for the fallback figures, then `npm run check:fonts`.

## Files

| File | What it is | Source | Version | SHA-256 |
| --- | --- | --- | --- | --- |
| `AtkinsonHyperlegibleNext-Variable.woff2` | Atkinson Hyperlegible Next, weights 200 to 800 | [googlefonts/atkinson-hyperlegible-next](https://github.com/googlefonts/atkinson-hyperlegible-next/blob/7925f50f649b3813257faf2f4c0b381011f434f1/fonts/webfonts/AtkinsonHyperlegibleNext%5Bwght%5D.woff2), commit `7925f50f649b3813257faf2f4c0b381011f434f1`, file `fonts/webfonts/AtkinsonHyperlegibleNext[wght].woff2` | 2.001 | `abde1ad5cf78b9ac575ef90d991f2e9101eb0b3b6668bde9a00e2e1e27d99afd` |
| `AtkinsonHyperlegibleMono-Variable.woff2` | Atkinson Hyperlegible Mono, weights 200 to 800 | [googlefonts/atkinson-hyperlegible-next-mono](https://github.com/googlefonts/atkinson-hyperlegible-next-mono/blob/154d50362016cc3e873eb21d242cd0772384c8f9/fonts/webfonts/AtkinsonHyperlegibleMono%5Bwght%5D.woff2), commit `154d50362016cc3e873eb21d242cd0772384c8f9`, file `fonts/webfonts/AtkinsonHyperlegibleMono[wght].woff2` | 2.001 | `4cf41c5cacdb2e98311929f3a482e95b2299ca34e6f389e8968a9075e355d58a` |
| `MelophosMusicSigns.woff2` | The sharp, flat and natural signs (U+266F, U+266D and U+266E), a subset of Bravura Text | Built from [`BravuraText.otf`](https://github.com/steinbergmedia/bravura/blob/bravura-1.482/redist/otf/BravuraText.otf), tag `bravura-1.482`, commit `37b194378b710cc40e406ab6c4b07608bb9548ae` (SHA-256 of that source file `e515b9534ee4acce6d64e086b26c872d67507b85586af18b4f77402b695bf6bf`) | 1.482 | `ec39b4004af159fb890e0c901c53d4c3c86c4eaa8eeab2cc139e694c4d4fd56b` |

The first two files are the unmodified files from the typeface's official repository. They are the web builds the
project publishes. The weight axis runs from 200 to 800 in one file, so the 450 used for body text on dark needs no
second file.

## Licences

| Licence file | Covers |
| --- | --- |
| [`OFL-AtkinsonHyperlegibleNext.txt`](OFL-AtkinsonHyperlegibleNext.txt) | Atkinson Hyperlegible Next. SIL Open Font License 1.1. It names no reserved font name |
| [`OFL-AtkinsonHyperlegibleMono.txt`](OFL-AtkinsonHyperlegibleMono.txt) | Atkinson Hyperlegible Mono. SIL Open Font License 1.1. It names no reserved font name |
| [`OFL-MelophosMusicSigns-from-Bravura.txt`](OFL-MelophosMusicSigns-from-Bravura.txt) | The music signs file. SIL Open Font License 1.1 with the reserved font name "Bravura" |

## Why there is a music signs file

Atkinson Hyperlegible Next and Mono do not contain the real sharp, flat and natural signs. `tests/fonts.test.ts` proves
it. The specification says to take those three signs from a subset of Bravura Text when that happens.

Bravura reserves its name, so a subset counts as a modified version and may not use it. The file is therefore renamed
"Melophos Music Signs" in every name field. The copyright and licence notices stay as they were. The steps are in
[`../../../scripts/subset-music-signs.py`](../../../scripts/subset-music-signs.py):

```bash
python3 -m venv venv
venv/bin/pip install fonttools brotli
venv/bin/python scripts/subset-music-signs.py BravuraText.otf src/styles/fonts/MelophosMusicSigns.woff2
```

The line metrics of the subset are set to those of Atkinson Hyperlegible so a sign never changes the height of a line.

## How the files load

[`fonts.css`](fonts.css) declares each family with `font-display: swap` and a fallback family built from the metrics of
Verdana (text) or Courier New (code). The fallback has `size-adjust`, `ascent-override` and `descent-override` figures
from capsize, so the text does not move when the font arrives. The music signs face uses a `unicode-range` of the three
signs and is fetched only on a page that shows one.

A page that shows text, code and a music sign loads three files. The specification asks for two at most. The music file
is 4.5 kB. Merging the three signs into the text font would bring the count back to two. That choice is open.
