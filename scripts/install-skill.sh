#!/usr/bin/env bash
# Устанавливает скилл nessy-orch в пользовательские скиллы Claude Code (~/.claude/skills/),
# чтобы Claude работал оркестратором nessy в любом проекте, а не только в этом репозитории.
#
#   scripts/install-skill.sh            # симлинк: обновления репозитория подхватываются сами
#   scripts/install-skill.sh --copy     # копия (если репозиторий будет перемещён или удалён)
#   scripts/install-skill.sh --uninstall
#
# Каталог назначения можно переопределить: CLAUDE_HOME=/path scripts/install-skill.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/.claude/skills/nessy-orch"
DEST_DIR="${CLAUDE_HOME:-$HOME/.claude}/skills"
DEST="$DEST_DIR/nessy-orch"
MODE="link"

case "${1:-}" in
	--copy) MODE="copy" ;;
	--uninstall) MODE="uninstall" ;;
	"") ;;
	-h | --help)
		sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	*)
		echo "неизвестный аргумент: $1 (см. --help)" >&2
		exit 2
		;;
esac

if [[ "$MODE" == "uninstall" ]]; then
	if [[ -e "$DEST" || -L "$DEST" ]]; then
		rm -rf "$DEST"
		echo "✓ скилл удалён: $DEST"
	else
		echo "скилл не установлен ($DEST)"
	fi
	exit 0
fi

[[ -f "$SRC/SKILL.md" ]] || { echo "не найден $SRC/SKILL.md" >&2; exit 1; }
mkdir -p "$DEST_DIR"

# прежнюю установку (копию или ссылку) заменяем; чужой каталог без нашего SKILL.md не трогаем
if [[ -L "$DEST" ]]; then
	rm "$DEST"
elif [[ -d "$DEST" ]]; then
	if grep -q '^name: nessy-orch' "$DEST/SKILL.md" 2>/dev/null; then
		rm -rf "$DEST"
	else
		echo "в $DEST лежит что-то другое — удалите вручную или выберите CLAUDE_HOME" >&2
		exit 1
	fi
fi

if [[ "$MODE" == "copy" ]]; then
	cp -R "$SRC" "$DEST"
	echo "✓ скилл скопирован: $DEST"
else
	ln -s "$SRC" "$DEST"
	echo "✓ скилл подключён ссылкой: $DEST → $SRC"
fi

# подсказка про CLI: скилл вызывает `nessy-orch`, он должен быть в PATH
if ! command -v nessy-orch >/dev/null 2>&1; then
	echo
	echo "Внимание: команды nessy-orch нет в PATH. Добавьте, например:"
	echo "  ln -s \"$ROOT/bin/nessy-orch\" ~/.local/bin/nessy-orch"
	echo "или export PATH=\"$ROOT/bin:\$PATH\" в профиль shell."
fi
echo "Перезапустите Claude Code, чтобы скилл подхватился."
