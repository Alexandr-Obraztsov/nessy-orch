#!/bin/sh
# Открыть HTML-файл в браузере по умолчанию: open.sh <файл.html>
[ -f "$1" ] || { echo "нет файла: $1" >&2; exit 2; }
case "$(uname)" in
	Darwin) open "$1" ;;
	*) xdg-open "$1" >/dev/null 2>&1 ;;
esac
