#!/usr/bin/env bash
# Устанавливает скиллы nessy-orch (ядро-оркестратор и рецепты из plugins/nessy/skills) туда, куда нужно:
#
#   scripts/install.sh                       # в Claude Code: ~/.claude/skills
#   scripts/install.sh nessy                 # в nessy: ~/.nessy/skills
#   scripts/install.sh claude --project DIR  # в проект: DIR/.claude/skills
#   scripts/install.sh nessy --project DIR   # в проект: DIR/.nessy/skills
#   scripts/install.sh --dir PATH            # в произвольный каталог скиллов
#
# Опции:
#   --copy        копировать вместо симлинков (по умолчанию — ссылки: обновления репозитория подхватываются сами)
#   --only A,B    только перечисленные скиллы (например: --only nessy-orch,code-question)
#   --uninstall   удалить установленные скиллы nessy-orch из выбранного места
#   --list        показать доступные скиллы и выйти
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/plugins/nessy/skills"
TARGET="claude"
PROJECT=""
DIR=""
MODE="link"
ONLY=""

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
	case "$1" in
		claude | nessy) TARGET="$1" ;;
		--project) PROJECT="${2:?--project требует путь}"; shift ;;
		--dir) DIR="${2:?--dir требует путь}"; shift ;;
		--copy) MODE="copy" ;;
		--uninstall) MODE="uninstall" ;;
		--only) ONLY="${2:?--only требует список}"; shift ;;
		--list) MODE="list" ;;
		-h | --help) usage; exit 0 ;;
		*) echo "неизвестный аргумент: $1 (см. --help)" >&2; exit 2 ;;
	esac
	shift
done

[[ -d "$SRC" ]] || { echo "не найден каталог скиллов: $SRC" >&2; exit 1; }

# список скиллов: каталоги с SKILL.md
SKILLS=()
for d in "$SRC"/*/; do
	[[ -f "$d/SKILL.md" ]] && SKILLS+=("$(basename "$d")")
done
if [[ -n "$ONLY" ]]; then
	IFS=',' read -r -a WANT <<<"$ONLY"
	for w in "${WANT[@]}"; do
		[[ -f "$SRC/$w/SKILL.md" ]] || { echo "нет такого скилла: $w (см. --list)" >&2; exit 2; }
	done
	SKILLS=("${WANT[@]}")
fi

if [[ "$MODE" == "list" ]]; then
	for s in "${SKILLS[@]}"; do
		desc=$(sed -n 's/^description: //p' "$SRC/$s/SKILL.md" | head -1)
		desc="${desc%%. *}"; desc="${desc%% — *}" # первая фраза, без обрезки посреди буквы
		printf '  %-16s %s\n' "$s" "$desc"
	done
	exit 0
fi

# каталог назначения
if [[ -n "$DIR" ]]; then
	DEST="$DIR"
elif [[ -n "$PROJECT" ]]; then
	DEST="$(cd "$PROJECT" && pwd)/.$TARGET/skills"
else
	DEST="$HOME/.$TARGET/skills"
fi

# наш ли это скилл (ссылка в этот репозиторий или копия с тем же name)
ours() {
	local p="$1" s="$2"
	if [[ -L "$p" ]]; then
		[[ "$(readlink "$p")" == "$SRC/$s" ]]
	else
		grep -q "^name: $s\$" "$p/SKILL.md" 2>/dev/null
	fi
}

if [[ "$MODE" == "uninstall" ]]; then
	for s in "${SKILLS[@]}"; do
		p="$DEST/$s"
		if [[ -e "$p" || -L "$p" ]]; then
			if ours "$p" "$s"; then rm -rf "$p" && echo "✓ удалён $p"; else echo "пропущен $p — не наш скилл" >&2; fi
		fi
	done
	exit 0
fi

mkdir -p "$DEST"
for s in "${SKILLS[@]}"; do
	p="$DEST/$s"
	if [[ -e "$p" || -L "$p" ]]; then
		if ours "$p" "$s"; then
			rm -rf "$p"
		else
			echo "пропущен $s: в $p лежит чужой скилл (удалите его или используйте --dir)" >&2
			continue
		fi
	fi
	if [[ "$MODE" == "copy" ]]; then
		cp -R "$SRC/$s" "$p"
	else
		ln -s "$SRC/$s" "$p"
	fi
	echo "✓ $s → $p"
done

echo
echo "Установлено в $DEST ($([[ $MODE == copy ]] && echo копии || echo симлинки))."
if ! command -v nessy-orch >/dev/null 2>&1; then
	echo "Команды nessy-orch нет в PATH — скиллы её вызывают. Добавьте, например:"
	echo "  ln -s \"$ROOT/bin/nessy-orch\" ~/.local/bin/nessy-orch"
fi
echo "Перезапустите $([[ $TARGET == nessy ]] && echo nessy || echo 'Claude Code'), чтобы скиллы подхватились."
