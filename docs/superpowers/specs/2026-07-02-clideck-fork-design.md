# CliDeck Fork — Design

**Datum:** 2026-07-02
**Status:** Vom User freigegeben (Design-Gespräch in Session „clideck")
**Upstream:** https://github.com/rustykuntz/clideck (MIT, aktiv, Stand v1.31.23)
**Fork:** `LEONARDONOVELLA/clideck`, lokaler Clone `~/clideck`
**Hinweis:** Diese Datei wandert nach dem Clone in das Fork-Repo (`docs/superpowers/specs/`).

## Ziel

CliDeck so forken, dass Upstream-Updates weiter einfließen können, und fünf
UX-Features ergänzen: alphabetische Projekt-Sortierung, pinnbare Projekte mit
manueller Reihenfolge, Schnell-Löschen per X, Mehrfach-Löschen, Sessions verstecken. Oberste Priorität: **Session-Daten sind heilig** — Backup
vor jeder Änderung, Daten und Code bleiben strikt getrennt.

## Datensicherheit (Grundlage, zuerst erledigt)

Der Fork ändert nur Programmcode. Die Daten liegen außerhalb und bleiben unberührt:

| Daten | Ort | Inhalt |
|---|---|---|
| CliDeck | `~/.clideck` | config.json (Projekte), sessions.json (139 Sessions, Resume-Tokens), transcripts/ |
| Claude-Kontext | `~/.claude/projects` | 3,1 GB Konversations-Transkripte (95 Projekte) |
| Codex-Sessions | `~/.codex/sessions` + `history.jsonl` | 5,1 GB |

**Backup (erledigt 2026-07-02):**
- Lokal: `~/CliDeck-Backups/` — tar-Snapshot von `~/.clideck` (datiert) + rsync-Mirror von Claude-Projekten + Codex-Sessions
- Extern: identische Kopie auf `/media/leonardo/My Book/CliDeck-Backups/`

**Backup-Automatisierung (Teil der Implementierung):**
- Script `clideck-backup` + systemd-User-Timer (täglich):
  tar-Snapshot `~/.clideck` (Aufbewahrung: 14 Stück), rsync-Mirror Claude + Codex,
  Kopie auf My Book, wenn gemountet (Fehlen von My Book ist kein Fehler, nur Log-Hinweis).
- Vor jedem `clideck-update` (Upstream-Merge) läuft automatisch ein Backup.

## Fork- & Update-Workflow (Ansatz A, freigegeben)

- GitHub-Fork unter `LEONARDONOVELLA/clideck`, Clone nach `~/clideck`,
  Remote `upstream` = rustykuntz/clideck.
- `main` bleibt reiner Upstream-Spiegel (nie eigene Commits).
- Jedes Feature = eigener Branch von `main` (sauber, später einzeln als PR anbietbar).
- Betriebs-Branch **`leo`** = `main` + Merge aller Feature-Branches. Der systemd-Service
  (`~/.config/systemd/user/clideck.service`) zeigt auf `node ~/clideck/server.js` statt
  aufs globale npm-Paket. Port 4000 und `~/.clideck`-Config bleiben unverändert.
- Update-Script `clideck-update`: Backup → `git fetch upstream` → `main` fast-forward →
  Merge in `leo` → `systemctl --user restart clideck`. Konflikte stoppen das Script mit
  klarer Meldung (kein automatisches Weiterwürgen).
- Basis-Version: **v1.31.23** (bringt den Unread-Filter-Fix aus v1.31.20 mit).
- Der lokale Hotfix vom 2026-07-01 (`claude-session.js`, Session-ID-Wechsel-Schutz,
  Original in `~/.clideck/rescue-backups/`) wird gegen v1.31.23 geprüft: falls Upstream
  das Problem nicht abdeckt, wird er ein eigener Commit im Fork; sonst entfällt er.
- Upstream-PRs: pro Feature später entscheidbar; nichts geht ohne explizites OK raus.

## Features

### 1. Alphabetische Projekt-Sortierung
- Sortierung ausschließlich beim Rendern in `regroupSessions()`
  (`public/js/terminals.js`) — `state.cfg.projects` wird vor dem Zeichnen kopiert und
  sortiert; die gespeicherte Reihenfolge in `config.json` bleibt unangetastet
  (minimale Merge-Konfliktfläche).
- Settings-Schalter „Sort projects alphabetically", Default: **an**.
- Solange aktiv, ist Drag-Reorder für Projekt-Header deaktiviert (würde sonst sofort
  übersortiert). Sessions innerhalb eines Projekts sind nicht betroffen.
- Sortierung: case-insensitiv, numerisch-bewusst (`localeCompare` mit `numeric: true`).

### 2. Projekte pinnen (mit manueller Reihenfolge)
- Neuer Eintrag „Pin project" / „Unpin project" im bestehenden ⋮-Projektmenü
  (`public/js/app.js`, Project-Menu-Handler).
- Persistenz: Felder `pinned: true` und `pinOrder: <number>` am Projekt-Objekt in
  `config.json` (passt zum Schema `id/name/path/color/collapsed`); Server
  persistiert über den vorhandenen Projekt-Update-Pfad.
- Anzeige: Gepinnte Projekte immer oben, **in vom User frei wählbarer Reihenfolge**
  (Drag & Drop innerhalb der gepinnten Zone, aktualisiert `pinOrder`), kleines
  Pin-Icon im Projekt-Header. Neu gepinnte Projekte landen am Ende der Pinned-Zone.
  Danach die restlichen Projekte alphabetisch (bzw. in Config-Reihenfolge, wenn
  Sortierung aus).
- Drag-Verhalten: Innerhalb der Pinned-Zone erlaubt (ändert `pinOrder`); Ziehen
  eines ungepinnten Projekts bleibt bei aktivierter Alphabet-Sortierung deaktiviert.

### 3. Schnell-Löschen per X
- Hover über eine Session-Zeile blendet rechts ein X ein (Stil analog zum
  vorhandenen Trash-Icon im Plugin-Panel).
- Klick → vorhandener Confirm-Dialog (`confirm.js` / `confirmClose()`) → Lösch-Pfad:
  - Aktive Sessions: bestehendes `send({type:'close', id})`.
  - „Resume →"-Einträge: **neue, kleine Server-Nachricht `session.forget`**
    (entfernt den Eintrag aus `sessions.json` und broadcastet die aktualisierte
    Resumable-Liste). Verifiziert: ein solcher Pfad existiert upstream noch nicht
    (nur `session.resume`, `close`, `project.delete`).
- **Datensicherheit:** Löschen entfernt nur CliDecks Verwaltungs-Eintrag. Die
  eigentlichen Konversations-Transkripte (`~/.claude/projects`, `~/.codex/sessions`)
  werden nie angerührt — eine gelöschte Session ist über `claude --resume` im
  Projektordner weiterhin auffindbar, zusätzlich zum Backup.

### 4. Mehrfach-Löschen (Auswahlmodus)
- Button in der Sidebar-Toolbar (bei Suche/Filter-Tabs) schaltet den Auswahlmodus um.
- Im Auswahlmodus: Checkbox an jeder Session-Zeile (aktive + dormant), Klick auf
  Zeile toggelt nur die Auswahl (öffnet keine Session), unten fixer Balken
  „Delete selected (n)" + „Cancel".
- Ein einziger Confirm-Dialog mit Anzahl, dann sequenzielles Löschen aller gewählten
  Sessions über dieselben Pfade wie Feature 3. Esc oder „Cancel" verlässt den Modus.

### 5. Sessions verstecken
- Neuer Eintrag „Hide session" im Session-Kontextmenü (rechte Maustaste, wo auch
  Rename/Delete liegen) sowie als Aktion im Auswahlmodus („Hide selected (n)").
- Persistenz: Feld `hidden: true` am Session-Eintrag in `sessions.json`, analog zum
  vorhandenen `muted`-Feld; neue kleine Server-Nachricht `session.hide` nach dem
  Muster von `session.mute`.
- Anzeige: Versteckte Sessions erscheinen nicht in der normalen Liste. Am unteren
  Rand der Sidebar ein dezenter Toggle „Hidden (n)" — aufgeklappt zeigt er die
  versteckten Sessions mit „Unhide"-Aktion. Verstecken beendet nichts und löscht
  nichts: eine versteckte aktive Session läuft weiter, eine versteckte dormante
  bleibt resümierbar.
- Unread-Verhalten: Versteckte Sessions zählen nicht in den Unread-Badge (wer sie
  versteckt, will sie nicht sehen).

### 6. Unread-Tab-Verhalten (kein eigenes Feature mehr)
- Upstream v1.31.20 behält den Unread-Tab bei, solange weitere ungelesene Sessions
  existieren. Nach dem Rebase auf v1.31.23 wird das Verhalten manuell verifiziert;
  nur falls es vom Wunsch abweicht (z. B. Tab-Wechsel bei der letzten ungelesenen
  Session), kommt ein Mini-Patch als eigener Feature-Branch dazu.

## Fehlerbehandlung

- `clideck-update` bricht bei Merge-Konflikten ab und lässt den laufenden Dienst
  unangetastet (alter Stand läuft weiter, bis Konflikt gelöst ist).
- Backup-Script: My Book nicht gemountet → Warnung ins Log, lokales Backup zählt.
- Multi-Delete: Fehler beim Löschen einer einzelnen Session stoppt die restlichen
  nicht; am Ende Toast mit Ergebnis (n gelöscht, m fehlgeschlagen).

## Verifikation

- Nach jedem Feature: Service aus dem Fork starten, mit den echten 22 Projekten /
  139 Sessions im Browser durchklicken (Sortierung, Pin, X-Löschen mit Confirm,
  Multi-Delete, Unread-Tab).
- Upstream-Smoke-Tests (seit v1.31.20 im Repo) laufen lassen, sofern vorhanden/lauffähig.
- Vor dem Umstellen des systemd-Service: Fork parallel auf anderem Port testen ist
  nicht nötig (gleiche Config), aber der npm-Stand bleibt installiert als Fallback —
  Rollback = ExecStart in der Unit zurückdrehen.

## Bewusst nicht im Scope

- Keine Umbauten an Server-Architektur, Terminal-Handling oder Plugins.
- Keine Migration der Config, kein Umzug von `~/.clideck`.
- Keine automatischen Upstream-PRs.
