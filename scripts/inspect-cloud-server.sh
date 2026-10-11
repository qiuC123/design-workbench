#!/usr/bin/env bash
# Read-only deployment preflight. Does not install, restart or change settings.
set -u
printf 'System\n'
uname -m
if [ -r /etc/os-release ]; then cat /etc/os-release; fi
printf '\nCurrent user\n'
id
printf '\nMemory\n'
free -m
printf '\nDisk space\n'
df -h /
printf '\nRelevant listening ports\n'
if command -v ss >/dev/null 2>&1; then
  ss -lntp | awk 'NR == 1 || $4 ~ /:(22|80|443|4175)$/'
fi
printf '\nInstalled runtimes\n'
for program in node npm docker nginx caddy; do
  command -v "$program" || true
done
if command -v node >/dev/null 2>&1; then node --version; fi
printf '\nDocker status (when accessible)\n'
if command -v docker >/dev/null 2>&1; then
  docker info --format 'Server={{.ServerVersion}} OS={{.OSType}} Architecture={{.Architecture}}' 2>&1 || true
  docker compose version 2>&1 || true
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' 2>&1 || true
  docker network ls --format '{{.Name}}' 2>&1 || true
fi
printf '\nIPv4 routes (check for Docker subnet overlap)\n'
if command -v ip >/dev/null 2>&1; then ip -4 route; fi
