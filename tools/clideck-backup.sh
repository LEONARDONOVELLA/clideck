#!/bin/bash
# Backup CliDeck + agent session data. Data is sacred — copies only, never touches sources.
set -uo pipefail
LOCAL=~/CliDeck-Backups
EXTERN="/media/leonardo/My Book/CliDeck-Backups"
STAMP=$(date +%Y-%m-%d_%H%M)
KEEP=14

mkdir -p "$LOCAL"
tar czf "$LOCAL/clideck-data_$STAMP.tar.gz" -C "$HOME" .clideck
rsync -a --delete "$HOME/.claude/projects/" "$LOCAL/claude-projects-mirror/"
rsync -a --delete "$HOME/.codex/sessions/"  "$LOCAL/codex-sessions-mirror/"
cp -f "$HOME/.codex/history.jsonl" "$LOCAL/codex-history.jsonl" 2>/dev/null

# Rotate tar snapshots, keep newest $KEEP
ls -1t "$LOCAL"/clideck-data_*.tar.gz 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f

if [ -d "$EXTERN" ] || mkdir -p "$EXTERN" 2>/dev/null; then
  rsync -a --delete "$LOCAL/" "$EXTERN/" && echo "extern: ok"
else
  echo "extern: My Book nicht gemountet — nur lokales Backup" >&2
fi
echo "backup ok: $STAMP"
