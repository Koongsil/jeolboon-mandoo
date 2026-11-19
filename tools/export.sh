#!/bin/sh
# SWF -> build/ (XML, SVG, scripts, sounds) using JPEXS FFDec.
# Requires Java. FFDec is downloaded into tools/ffdec if missing.
set -e
cd "$(dirname "$0")/.."
SWF=original/b3_mandu.swf
FFDEC=tools/ffdec/ffdec.jar
VER=26.5.0

if [ ! -f "$FFDEC" ]; then
  echo "Downloading FFDec $VER..."
  curl -sL -o tools/ffdec.zip "https://github.com/jindrapetrik/jpexs-decompiler/releases/download/version$VER/ffdec_$VER.zip"
  mkdir -p tools/ffdec && unzip -q -o tools/ffdec.zip -d tools/ffdec && rm tools/ffdec.zip
fi

rm -rf build && mkdir -p build/export build/svg
J="java -Djava.awt.headless=true -jar $FFDEC"
$J -swf2xml "$SWF" build/mandu.xml
$J -export script,sound "$SWF" build/export
$J -format shape:svg,morphshape:svg,text:svg -export shape,morphshape,text build/svg "$SWF"
echo "Done. Now run: npm run extract"
