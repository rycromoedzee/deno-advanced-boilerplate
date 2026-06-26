#!/bin/bash

# Threat intelligence updater with combined sources and database storage
# Updates threat intelligence from all sources and stores in PostgreSQL database

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
    echo "📄 Loading environment variables from .env file..."
    set -a  # Automatically export all variables
    source .env
    set +a  # Stop automatically exporting
else
    echo "⚠️  No .env file found in project root"
fi

echo "🛡️  Threat Intelligence Updater"
echo "================================"
echo ""

# Function to show usage
show_usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Updates threat intelligence from combined sources:"
    echo "  - FireHOL Level 1/2"
    echo "  - Ipsum"
    echo "  - Tor exit nodes"
    echo "  - Abuse.ch"
    echo ""
    echo "All data is imported directly to PostgreSQL with proper source tracking."
    echo ""
    echo "Options:"
    echo "  --ipsum-level N     Set minimum ipsum threat level (default: 3)"
    echo "  --include-private   Include private IP ranges (default: false)"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  DATABASE_URL        Required PostgreSQL connection string"
    echo "  REDIS_URL          Optional Redis URL for caching"
    echo ""
    echo "Examples:"
    echo "  $0                         # Update with default settings"
    echo "  $0 --ipsum-level 4         # Use higher confidence threshold"
    echo "  $0 --include-private       # Include private IP ranges"
}

# Parse options
IPSUM_THREAT_LEVEL=""
INCLUDE_PRIVATE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --ipsum-level)
            IPSUM_THREAT_LEVEL="$2"
            shift 2
            ;;
        --include-private)
            INCLUDE_PRIVATE="true"
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            echo "❌ Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

echo "🚀 Running combined threat intelligence update with database storage..."

# Check for required DATABASE_URL
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "❌ Error: DATABASE_URL environment variable is required"
    echo "   Set your PostgreSQL connection string in DATABASE_URL"
    exit 1
fi

# Set environment variables if provided
export_vars=""
if [[ -n "$IPSUM_THREAT_LEVEL" ]]; then
    export IPSUM_THREAT_LEVEL="$IPSUM_THREAT_LEVEL"
    export_vars="IPSUM_THREAT_LEVEL=$IPSUM_THREAT_LEVEL "
fi
if [[ -n "$INCLUDE_PRIVATE" ]]; then
    export INCLUDE_PRIVATE="$INCLUDE_PRIVATE"
    export_vars="${export_vars}INCLUDE_PRIVATE=$INCLUDE_PRIVATE "
fi

echo "Environment: ${export_vars:-default settings}"
echo "Database: Connected to PostgreSQL"
echo ""

deno run --allow-net --allow-read --allow-write --allow-env --allow-sys --unstable-kv scripts/threats/update-combined-threats.ts

echo ""
echo "✅ Threat intelligence update completed!"
echo ""
echo "💡 Next steps:"
echo "   - Threat intelligence is now available in your PostgreSQL database"
echo "   - The application will automatically use the database for real-time IP lookups"
echo "   - Consider scheduling this script to run daily via cron"
echo "   - Monitor database performance and cache hit rates for optimization"