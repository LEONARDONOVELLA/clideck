#!/bin/bash
# Pull upstream updates into the running fork. Aborts on conflicts, leaving the service untouched.
set -euo pipefail
cd ~/clideck
"$(dirname "$0")/clideck-backup.sh"
git fetch upstream --tags
git checkout main
git merge --ff-only upstream/main
git checkout leo
if ! git merge --no-ff main -m "Merge upstream $(git describe --tags main 2>/dev/null || git rev-parse --short main)"; then
  git merge --abort
  git checkout leo
  echo "MERGE-KONFLIKT: leo unverändert, Dienst läuft weiter. Konflikt manuell lösen." >&2
  exit 1
fi
git push origin main leo
# Privaten Spiegel aktuell halten (Fehlen des Remotes ist kein Fehler)
if git remote get-url mirror >/dev/null 2>&1; then
  git push mirror --all && git push mirror --tags || echo "WARNUNG: mirror-Push fehlgeschlagen" >&2
fi
systemctl --user restart clideck
echo "update ok: $(git log --oneline -1)"
