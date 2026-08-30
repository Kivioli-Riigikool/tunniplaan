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

# Iga jooks kirjutab lehele uue "Leht uuendatud" aja, seega failid
# erinevad alati. Sisulise muudatuse tuvastamiseks jatame just need
# read korvale.
SISULINE=$(git diff -U0 -- dist \
  | grep -E '^[+-]' \
  | grep -Ev '^(\+\+\+|---)' \
  | grep -v 'Leht uuendatud' \
  | head -1 || true)

if [ -z "$SISULINE" ]; then
  echo "==> Tunniplaan ega asendused ei muutunud, ei avalda"
  git checkout -- dist
  exit 0
fi

echo "==> Avaldan"
git add dist
git commit -q -m "Uuenda tunniplaan ($KUUPAEV)"
git push -q origin main

echo "==> Tehtud. Leht uueneb u minuti parast:"
echo "    https://jubejuss.github.io/tunniplaan/"
echo "    jalgi: gh run watch"
