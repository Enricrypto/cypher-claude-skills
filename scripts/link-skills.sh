#!/usr/bin/env bash
#
# Link this repo's skills into ~/.claude/skills/ so Claude Code always reads the LATEST
# version straight from the working tree.
#
# This replaces the old `npx cypher-skills sync`, which COPIED files into each project and
# therefore went stale the moment you edited the source. Symlinks cannot drift.
#
#   ./scripts/link-skills.sh          # link
#   ./scripts/link-skills.sh --dry    # show what would happen
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills/software}"
DRY=false
[[ "${1:-}" == "--dry" ]] && DRY=true

mkdir -p "$DEST"

link() {
  local src="$1"
  local name="$2"
  local target="$DEST/$name"

  if [[ -e "$target" && ! -L "$target" ]]; then
    echo "  SKIP  $name — a real file/dir is already there; not clobbering it"
    return
  fi

  if $DRY; then
    echo "  LINK  $name -> $src"
  else
    ln -sfn "$src" "$target"
    echo "  ✓     $name"
  fi
}

echo "Linking skills from $REPO into $DEST"

# Single-file skills
for f in "$REPO"/skills/*.md; do
  [[ -e "$f" ]] || continue
  link "$f" "$(basename "$f")"
done

# Directory skills (each has a SKILL.md)
for d in "$REPO"/skills/*/; do
  [[ -f "$d/SKILL.md" ]] || continue
  link "${d%/}" "$(basename "${d%/}")"
done

echo
echo "Done. Claude Code now reads these directly from the repo — edit the source and the"
echo "change is live immediately. No sync step, no stale copies."
