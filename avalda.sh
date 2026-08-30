#!/usr/bin/env bash
# Genereerib tunniplaani ja avaldab selle GitHub Pagesisse.
#
# Miks kasitsi: EduPage ei vasta GitHubi runneri IP-le, seega peab
# genereerimine kaima masinast, mis EduPage'ini paaseb. Vt README.
#
# Kasutus:
#   ./avalda.sh                # tanane kuupaev
#   ./avalda.sh 2026-09-15     # konkreetne paev (asenduste jaoks)

set -euo pipefail
cd "$(dirname "$0")"

KUUPAEV="${1:-$(date +%F)}"

echo "==> Genereerin ($KUUPAEV)"
node edupage-generate.mjs koik "$KUUPAEV"

if git diff --quiet -- dist && git diff --cached --quiet -- dist; then
  echo "==> dist/ ei muutunud, ei avalda"
  exit 0
fi

echo "==> Avaldan"
git add dist
git commit -q -m "Uuenda tunniplaan ($KUUPAEV)"
git push -q origin main

echo "==> Tehtud. Leht uueneb u minuti parast:"
echo "    https://jubejuss.github.io/tunniplaan/"
echo "    jalgi: gh run watch"
