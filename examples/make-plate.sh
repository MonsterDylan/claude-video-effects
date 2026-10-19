#!/bin/bash
# Make a placeholder "talking head" plate so the examples run without real footage.
#   bash examples/make-plate.sh <out.mp4> [seconds=8]
# 1080x1920, 30 fps, H.264, slow moving gradient + a soft head-and-shoulders silhouette + a silent audio track.
# Writes <out.mp4> plus <dir>/face-copy1.mp4 and face-copy2.mp4 (plate copies for fileDrop / videoCard / multiverse).
set -e
OUT="${1:?usage: make-plate.sh <out.mp4> [seconds]}"
SECS="${2:-8}"
DIR="$(dirname "$OUT")"
mkdir -p "$DIR"
TMP="$(mktemp -d)"
# silhouette: head circle + shoulders ellipse, as a soft alpha mask (rendered once at quarter res, then scaled)
ffmpeg -nostdin -y -loglevel error -f lavfi -i "color=c=black:s=270x480:d=1" -frames:v 1 \
  -vf "format=rgba,geq=r='18':g='16':b='32':a='255*clip((1-hypot((X-135)/50,(Y-190)/60))*6,0,1)+255*clip((1-hypot((X-135)/125,(Y-470)/120))*6,0,1)',scale=1080:1920:flags=bicubic,boxblur=6" \
  "$TMP/sil.png"
ffmpeg -nostdin -y -loglevel error \
  -f lavfi -i "gradients=s=1080x1920:c0=0x2a1f5c:c1=0x0f3a4a:c2=0x3d1f4f:n=3:speed=0.004:d=${SECS}:r=30" \
  -loop 1 -i "$TMP/sil.png" \
  -f lavfi -i "anullsrc=r=48000:cl=stereo" \
  -filter_complex "[1:v]format=rgba[s];[0:v][s]overlay=0:0:shortest=1,format=yuv420p[v]" \
  -map "[v]" -map 2:a -t "$SECS" -c:v libx264 -preset medium -crf 30 -g 30 -keyint_min 30 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -b:a 64k -movflags +faststart "$OUT"
cp "$OUT" "$DIR/face-copy1.mp4"
cp "$OUT" "$DIR/face-copy2.mp4"
rm -rf "$TMP"
echo "plate -> $OUT (${SECS}s) + face-copy1.mp4 + face-copy2.mp4"
