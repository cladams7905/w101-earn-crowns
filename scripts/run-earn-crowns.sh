#!/bin/bash

# Wizard101 Earn Crowns Local Cron Script
# This script runs the earn-crowns TypeScript script and logs the output

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Create logs directory if it doesn't exist
LOGS_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOGS_DIR"

# Set up log files with timestamp
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
LOG_FILE="$LOGS_DIR/earn-crowns_$TIMESTAMP.log"
LATEST_LOG="$LOGS_DIR/earn-crowns_latest.log"

# Function to log with timestamp
log_with_timestamp() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to cleanup old log files (keep last 30 days)
cleanup_old_logs() {
    log_with_timestamp "🧹 Cleaning up old log files..."
    find "$LOGS_DIR" -name "earn-crowns_*.log" -type f -mtime +30 -delete 2>/dev/null || true
    log_with_timestamp "✅ Log cleanup completed"
}

# Start logging
log_with_timestamp "🚀 Starting Wizard101 Earn Crowns Script"
log_with_timestamp "📂 Project Directory: $PROJECT_DIR"
log_with_timestamp "📝 Log File: $LOG_FILE"

# Check if we should start running yet
if [ -n "$CRON_START_DATE" ]; then
    CURRENT_DATE=$(date -u +%s)
    START_DATE=$(date -d "$CRON_START_DATE" +%s 2>/dev/null || echo "0")
    
    if [ "$CURRENT_DATE" -lt "$START_DATE" ]; then
        log_with_timestamp "⏰ Not time to start yet. Will start at: $CRON_START_DATE"
        log_with_timestamp "📅 Current time: $(date -u)"
        exit 0
    fi
fi

# Check if .env.local exists
if [ ! -f "$PROJECT_DIR/.env.local" ]; then
    log_with_timestamp "❌ Error: .env.local file not found in $PROJECT_DIR"
    log_with_timestamp "Please create .env.local with required environment variables:"
    log_with_timestamp "  - WIZARD101_USERNAME"
    log_with_timestamp "  - WIZARD101_PASSWORD"
    log_with_timestamp "  - TWO_CAPTCHA_API_KEY"
    log_with_timestamp "  - NEXT_PUBLIC_SUPABASE_URL"
    log_with_timestamp "  - NEXT_PUBLIC_SUPABASE_ANON_KEY"
    log_with_timestamp "  - GEMINI_API_KEY (optional)"
    exit 1
fi

# Change to project directory
cd "$PROJECT_DIR" || {
    log_with_timestamp "❌ Error: Cannot change to project directory: $PROJECT_DIR"
    exit 1
}

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    log_with_timestamp "❌ Error: Node.js is not installed or not in PATH"
    exit 1
fi

# Check if npm is available
if ! command -v npm &> /dev/null; then
    log_with_timestamp "❌ Error: npm is not installed or not in PATH"
    exit 1
fi

# Check if ts-node is available
if ! command -v npx &> /dev/null || ! npx ts-node --version &> /dev/null; then
    log_with_timestamp "❌ Error: ts-node is not available. Installing dependencies..."
    npm install >> "$LOG_FILE" 2>&1 || {
        log_with_timestamp "❌ Error: Failed to install dependencies"
        exit 1
    }
fi

# Log system information
log_with_timestamp "💻 System Information:"
log_with_timestamp "   Node.js: $(node --version)"
log_with_timestamp "   npm: $(npm --version)"
log_with_timestamp "   OS: $(uname -s) $(uname -r)"
log_with_timestamp "   Architecture: $(uname -m)"

# Cleanup old logs before starting
cleanup_old_logs

# Run the earn-crowns script
log_with_timestamp "🎯 Executing earn-crowns script..."

# Set NODE_ENV if not set
export NODE_ENV="${NODE_ENV:-production}"

# Run the script and capture both stdout and stderr
if npx ts-node --project scripts/tsconfig.json scripts/earn-crowns.ts >> "$LOG_FILE" 2>&1; then
    EXIT_CODE=0
    log_with_timestamp "✅ Earn-crowns script completed successfully"
else
    EXIT_CODE=$?
    log_with_timestamp "❌ Earn-crowns script failed with exit code: $EXIT_CODE"
fi

# Create/update the latest log symlink
ln -sf "$LOG_FILE" "$LATEST_LOG"

# Log completion
log_with_timestamp "📊 Script execution completed"
log_with_timestamp "🕒 Total execution time: $SECONDS seconds"
log_with_timestamp "📁 Full log available at: $LOG_FILE"
log_with_timestamp "📋 Latest log available at: $LATEST_LOG"

# Exit with the same code as the main script
exit $EXIT_CODE 