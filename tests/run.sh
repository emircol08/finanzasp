#!/bin/sh
# Ejecuta las pruebas con el motor JavaScriptCore incluido en macOS (no requiere Node.js).
cd "$(dirname "$0")" && exec /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m run-jsc.js
