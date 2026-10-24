#!/usr/bin/env bash
# Optional offline validation toolchain, isolated inside this checkout.
# Windows: wsl -d Ubuntu-24.04 -- bash scripts/setup-meep-reference.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .reference-tools
cd .reference-tools
if [[ ! -x bin/micromamba ]]; then
  curl --fail --location https://micro.mamba.pm/api/micromamba/linux-64/latest --output micromamba.tar.bz2
  tar -xjf micromamba.tar.bz2 bin/micromamba
fi
./bin/micromamba create --yes --no-rc --root-prefix "$PWD/cache" --prefix "$PWD/meep" --channel conda-forge 'python=3.11' 'pymeep=*=nompi_*'
