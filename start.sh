#!/bin/bash

# Exit on any error
set -e

# Run bootstrap (global migrations + optional first-install seed)
echo "Running bootstrap..."
deno run --allow-read --allow-write --allow-env --allow-net --allow-ffi --allow-sys --allow-run scripts/init/bootstrap.ts

# Start the main application
echo "Starting main application on port 55555..."
exec deno serve --allow-read --allow-env --allow-sys --allow-run --allow-write --allow-net --unstable-kv --unstable-cron --unstable-worker-options --allow-ffi --host 0.0.0.0 --port 55555 main.ts
