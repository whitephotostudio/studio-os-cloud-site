#!/bin/sh
set -eu

task_mobile_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
task_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/studio-os-canon-ptp.XXXXXX")
trap 'rm -rf "$task_test_dir"' EXIT HUP INT TERM

xcrun swiftc \
  "$task_mobile_dir/ios/App/App/CanonPTP.swift" \
  "$task_mobile_dir/tests/CanonPTPTests.swift" \
  -o "$task_test_dir/canon-ptp-tests"
"$task_test_dir/canon-ptp-tests"
