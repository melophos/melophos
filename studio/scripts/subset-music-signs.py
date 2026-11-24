# builds MelophosMusicSigns.woff2 from the official BravuraText.otf: the sharp, flat and natural signs only.
# Bravura has a reserved font name under the SIL Open Font License, so the subset is renamed here.
# usage: python3 scripts/subset-music-signs.py BravuraText.otf src/styles/fonts/MelophosMusicSigns.woff2
# needs the fonttools and brotli Python packages. the steps are in src/styles/fonts/README.md.
import sys
from fontTools.ttLib import TTFont
from fontTools import subset
src, out = sys.argv[1], sys.argv[2]
opts = subset.Options()
opts.layout_features = []
opts.name_IDs = ['*']
opts.notdef_outline = True
opts.glyph_names = False
opts.flavor = 'woff2'
f = TTFont(src)
s = subset.Subsetter(opts)
s.populate(unicodes=[0x266D, 0x266E, 0x266F])
s.subset(f)
# a modified version may not carry the reserved font name, so every name field except the notices is replaced
nm = f['name']
nm.names = [r for r in nm.names if r.nameID != 7]
for r in nm.names:
    if r.nameID == 1: r.string = 'Melophos Music Signs'
    elif r.nameID == 3: r.string = '1.482;MELOPHOS;MelophosMusicSigns-Regular'
    elif r.nameID == 4: r.string = 'Melophos Music Signs Regular'
    elif r.nameID == 6: r.string = 'MelophosMusicSigns-Regular'
# line metrics follow the text face, so a sign from this file never changes a line's height
f['hhea'].ascent = 984; f['hhea'].descent = -316; f['hhea'].lineGap = 0
os2 = f['OS/2']; os2.sTypoAscender = 984; os2.sTypoDescender = -316; os2.sTypoLineGap = 0
os2.usWinAscent = 984; os2.usWinDescent = 316
f.flavor = 'woff2'
f.save(out)
g = TTFont(out)
print(sorted(hex(c) for c in g.getBestCmap()))
for r in g['name'].names:
    if r.platformID == 3: print(r.nameID, str(r)[:90].replace('\n', ' '))
