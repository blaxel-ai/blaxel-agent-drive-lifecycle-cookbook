#!/bin/sh
set -eu

exec /usr/local/bin/sandbox-api --user agent "$@"
