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
systemctl --user restart clideck
echo "update ok: $(git log --oneline -1)"
