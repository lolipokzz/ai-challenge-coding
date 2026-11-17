# Сторонние компоненты

Прямые зависимости интерфейса по установленным package.json:

| Компонент | Версия | Лицензия |
|---|---|---|
| react | 19.2.0 | MIT |
| react-dom | 19.2.0 | MIT |
| lucide-react | 0.468.0 | ISC |
| vite | 6.4.1 | MIT |
| Шрифт Onest (через @fontsource-variable/onest 5.3.1) | 5.3.1 | SIL OFL 1.1 |
| Шрифт JetBrains Mono (через @fontsource/jetbrains-mono 5.3.0) | 5.3.0 | SIL OFL 1.1 |

Шрифты Onest и JetBrains Mono лежат в `src/fonts/` и раздаются с того же сервера, без внешних CDN — прототип открывается из России без VPN. Тексты лицензий: `docs/licenses/onest-OFL.txt`, `docs/licenses/jetbrains-mono-OFL.txt`. Официальные логотипы вузов, внешние фотографии и платные материалы не используются. Иконки — lucide-react. Полные тексты лицензий находятся в пакетах node_modules; версии зависимостей зафиксированы в pnpm-lock.yaml. Серверный драйвер modernc.org/sqlite и его транзитивные зависимости перечислены в go.mod/go.sum; их лицензии необходимо сохранять при распространении соответствующего кода.

Лицензии прямых зависимостей сохранены в `docs/licenses/`, в том числе BSD-3-Clause для modernc.org/sqlite.
