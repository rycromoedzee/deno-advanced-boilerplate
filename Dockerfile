# syntax=docker/dockerfile:1
FROM denoland/deno:2.8.2

WORKDIR /app

# Cache the dependency graph first so source-only changes reuse this layer.
COPY deno.json deno.lock deps.ts ./
RUN deno cache deps.ts

# Copy the rest of the application source.
COPY . .

# Pre-compile the entrypoint (also caches its transitive imports).
RUN deno cache main.ts

# main.ts exports a default { fetch } handler, so it must be started with
# `deno serve` (see start.sh) rather than `deno run`. The app listens on 55555.
EXPOSE 55555

# Mirror start.sh: run bootstrap (global migrations + first-install seed),
# then serve the app with the same permission flags start.sh uses.
CMD ["sh", "-c", "deno run --allow-read --allow-write --allow-env --allow-net --allow-ffi --allow-sys --allow-run scripts/init/bootstrap.ts && exec deno serve --allow-read --allow-env --allow-sys --allow-run --allow-write --allow-net --unstable-kv --unstable-cron --unstable-worker-options --allow-ffi --host 0.0.0.0 --port 55555 main.ts"]
