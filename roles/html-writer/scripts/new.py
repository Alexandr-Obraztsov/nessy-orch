#!/usr/bin/env python3
"""Создать HTML-сводку из шаблона: styles.css встраивается в файл, поля заголовка подставляются.

  new.py <файл.html> --title "Название" [--subtitle "..."] [--eyebrow "План"]

Файл самодостаточен (стили внутри; шрифты и тему подтягивает браузер). Существующий файл не перезаписывается.
"""
import argparse, datetime, html, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'assets')

ap = argparse.ArgumentParser()
ap.add_argument('out')
ap.add_argument('--title', required=True)
ap.add_argument('--subtitle', default='')
ap.add_argument('--eyebrow', default='Сводка')
a = ap.parse_args()

if os.path.exists(a.out):
    sys.exit(f'{a.out} уже есть: правьте его на месте, а не создавайте заново')
tpl = open(os.path.join(ASSETS, 'base.html'), encoding='utf-8').read()
css = open(os.path.join(ASSETS, 'styles.css'), encoding='utf-8').read()
date = datetime.date.today().strftime('%d.%m.%Y')
tpl = tpl.replace('/*STYLES*/', css)
for k, v in {'TITLE': a.title, 'SUBTITLE': a.subtitle, 'EYEBROW': a.eyebrow, 'DATE': date}.items():
    tpl = tpl.replace(f'@@{k}@@', html.escape(v))
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
open(a.out, 'w', encoding='utf-8').write(tpl)
print(os.path.abspath(a.out))
