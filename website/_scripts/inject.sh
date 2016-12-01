#!/usr/bin/env bash
# This file:
#
#  - Injects markdown files into the ./website directory
#  - Changes them a little to make them more suitable for Jekyll building
#
# Usage:
#
#  ./inject.sh
#
# Based on a template by Transloadify v2.0.0
# http://transloadify.sh/#authors
#
# The MIT License (MIT)
# Copyright (c) 2013 Kevin van Zonneveld and contributors
# You are not obligated to bundle the LICENSE file with your b3bp projects as long
# as you leave these references intact in the header comments of your source files.

# Exit on error. Append || true if you expect an error.
set -o errexit
# Exit on error inside any functions or subshells.
set -o errtrace
# Do not allow use of undefined vars. Use ${VAR:-} to use an undefined VAR
set -o nounset
# Catch the error in case mysqldump fails (but gzip succeeds) in `mysqldump |gzip`
set -o pipefail
# Turn on traces, useful while debugging but commented out by default
# set -o xtrace

# Set magic variables for current file, directory, os, etc.
__dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
__file="${__dir}/$(basename "${BASH_SOURCE[0]}")"
__base="$(basename ${__file} .sh)"

for doc in "README" "FAQ" "CHANGELOG"; do
  targetName="$(echo "${doc}" | awk '{print tolower($0)}')"
  permalink="/${targetName}/"
  subtitle="$(tr '[:lower:]' '[:upper:]' <<< ${targetName:0:1})${targetName:1} | "
  redirectFrom="/${doc}.md/"
  backLink="\n\n<a href=\"/\">&laquo; Home</a>"
  if [ "${doc}" = "README" ]; then
    targetName="index"
    permalink="/"
    subtitle=""
    redirectFrom="nothing"
    backLink=""
  fi

  cat <<EOF > website/${targetName}.md
---
layout: default
permalink: ${permalink}
redirect_from: ${redirectFrom}
title: ${subtitle}Transloadify – Cloudencoding in a box
warning: This page is generated by ${__base}.sh based on ${doc}.md, please don't edit ${targetName}.md directly.
---
EOF
  # If '<!--more-->' exists, only inject what comes after it, so you can have e.g. a ToC or buildbuttons
  # on GitHub, without that also rendering in the site (site may have its own ToC rendering for instance)
  if grep '<!--more-->' ${doc}.md; then
    cat ${doc}.md |sed -n -e '/<!--more-->/,$p' | tail -n +2 >> website/${targetName}.md
  else
    cat ${doc}.md >> website/${targetName}.md
  fi

  # Add a "<- Back Home" link, if any
  echo -e $backLink >> website/${targetName}.md

  echo "--> written website/${targetName}.md"
done
