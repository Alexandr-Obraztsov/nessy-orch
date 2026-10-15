#!/usr/bin/env python3
"""Проверить HTML-сводку: токены и обе темы на месте, нет литералов цвета в разметке, нет неразрешённых внешних ресурсов,
остались ли незаполненные поля шаблона, заголовок, парность тегов. Выход 0 — замечаний нет, 1 — есть (текст в stdout).

  check.py <файл.html>
"""
import re, sys
from html.parser import HTMLParser

VOID = {'meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'col', 'area', 'base', 'wbr', 'embed', 'track'}
ALLOWED_SCRIPT = ('https://cdnjs.cloudflare.com/', 'https://cdn.jsdelivr.net/npm/', 'https://unpkg.com/')
ALLOWED_LINK = ('https://fonts.googleapis.com', 'https://fonts.gstatic.com')


class P(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.issues, self.title, self.in_title, self.has_h1 = [], [], '', False, False

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag == 'title': self.in_title = True
        if tag == 'h1': self.has_h1 = True
        if tag == 'script' and d.get('src') and not d['src'].startswith(ALLOWED_SCRIPT):
            self.issues.append(f"скрипт с неразрешённого адреса: {d['src']}")
        if tag == 'link' and d.get('href') and d['href'].startswith('http') and not d['href'].startswith(ALLOWED_LINK):
            self.issues.append(f"внешний стиль не с Google Fonts: {d['href']}")
        if tag == 'img' and d.get('src', '').startswith('http'):
            self.issues.append(f"внешняя картинка (встройте как data:): {d['src'][:60]}")
        if 'style' in d and re.search(r'(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()', d['style']):
            self.issues.append(f"литерал цвета в style (используйте токены var(--…)): {d['style'][:60]}")
        if tag not in VOID: self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag == 'title': self.in_title = False
        if tag in VOID: return
        if not self.stack or self.stack[-1] != tag:
            self.issues.append(f'не парный тег </{tag}> (открыт: {self.stack[-1] if self.stack else "ничего"})')
            if tag in self.stack:
                while self.stack and self.stack.pop() != tag: pass
        else:
            self.stack.pop()

    def handle_data(self, data):
        if self.in_title: self.title += data


def main(path):
    text = open(path, encoding='utf-8').read()
    p = P()
    p.feed(text)
    issues = p.issues
    if p.stack: issues.append(f'не закрыты теги: {", ".join(p.stack)}')
    if not p.title.strip(): issues.append('нет <title>')
    if not p.has_h1: issues.append('нет <h1>')
    m = re.search(r'@@[A-Z]+@@', text)
    if m: issues.append(f'не заполнено поле шаблона {m.group(0)}')
    if 'lorem ipsum' in text.lower(): issues.append('остался lorem ipsum')
    style = ' '.join(re.findall(r'<style[^>]*>(.*?)</style>', text, re.S))
    if style:
        root = re.search(r':root\s*\{([^}]*)\}', style)
        if not root or '--bg' not in root.group(1): issues.append('в :root нет токена --bg: нужны токены светлой темы')
        if 'prefers-color-scheme: dark' not in style: issues.append('нет тёмной темы (@media (prefers-color-scheme: dark))')
        if 'data-theme="dark"' not in style: issues.append('нет переопределения :root[data-theme="dark"]')
        if not re.search(r'body\s*\{[^}]*background', style): issues.append('у body нет явного background из токена')
        if 'overflow-x' not in style: issues.append('нет overflow-x: широкие таблицы и код не прокручиваются')
    else:
        issues.append('нет встроенных стилей: используйте scripts/new.py (он встраивает assets/styles.css)')
    if 'viewport' not in text: issues.append('нет meta viewport')
    if issues:
        print('\n'.join(f'- {i}' for i in issues))
        return 1
    print('замечаний нет')
    return 0


if len(sys.argv) != 2:
    sys.exit('использование: check.py <файл.html>')
sys.exit(main(sys.argv[1]))
