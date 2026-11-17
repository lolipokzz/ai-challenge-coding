#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if ! command -v go >/dev/null 2>&1; then
  for sdk in "$HOME"/sdk/go*/bin; do
    if [ -x "$sdk/go" ]; then PATH="$sdk:$PATH"; fi
  done
fi
if ! command -v node >/dev/null 2>&1 && [ -x /tmp/node-v22.16.0-darwin-arm64/bin/node ]; then
  PATH="/tmp/node-v22.16.0-darwin-arm64/bin:$PATH"
fi
export PATH
if ! command -v go >/dev/null 2>&1; then echo 'Установите Go и добавьте его в PATH.' >&2; exit 1; fi
if ! command -v node >/dev/null 2>&1; then echo 'Установите Node.js и добавьте его в PATH.' >&2; exit 1; fi
if command -v npm >/dev/null 2>&1; then
  if [ ! -d node_modules/react ] || [ ! -d node_modules/vite ]; then npm install; fi
  npm run build
elif command -v corepack >/dev/null 2>&1; then
  if [ ! -d node_modules/react ] || [ ! -d node_modules/vite ]; then corepack pnpm install --frozen-lockfile; fi
  node node_modules/vite/bin/vite.js build
else
  echo 'Нужен npm или corepack/pnpm для сборки React.' >&2; exit 1
fi
mkdir -p bin
go build -o bin/razumist .
exec ./bin/razumist --host 127.0.0.1 --port "${PORT:-8000}"
