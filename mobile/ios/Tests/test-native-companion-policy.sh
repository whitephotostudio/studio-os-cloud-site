#!/bin/sh
set -eu
policy_tests_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
policy_build_dir=$(mktemp -d "${TMPDIR:-/tmp}/studio-os-native-policy.XXXXXX")
trap 'rm -rf "$policy_build_dir"' EXIT HUP INT TERM
xcrun swiftc "$policy_tests_dir/../App/App/NativeCompanionPolicy.swift" "$policy_tests_dir/NativeCompanionPolicyTests.swift" -o "$policy_build_dir/policy-tests"
"$policy_build_dir/policy-tests"
