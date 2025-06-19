#!/bin/bash

# Wizard101 Earn Crowns - macOS Cron Setup Script
# This script helps set up a local cron job to run the earn-crowns script

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
RUN_SCRIPT="$SCRIPT_DIR/run-earn-crowns.sh"

echo -e "${BLUE}🎯 Wizard101 Earn Crowns - macOS Cron Setup${NC}"
echo -e "${BLUE}=============================================${NC}"
echo

# Check if the run script exists
if [ ! -f "$RUN_SCRIPT" ]; then
    echo -e "${RED}❌ Error: run-earn-crowns.sh not found at $RUN_SCRIPT${NC}"
    exit 1
fi

# Make sure the run script is executable
chmod +x "$RUN_SCRIPT"

echo -e "${GREEN}📂 Project Directory: $PROJECT_DIR${NC}"
echo -e "${GREEN}🏃 Run Script: $RUN_SCRIPT${NC}"
echo

# Check if .env.local exists
if [ ! -f "$PROJECT_DIR/.env.local" ]; then
    echo -e "${YELLOW}⚠️  Warning: .env.local file not found${NC}"
    echo -e "${YELLOW}   You'll need to create this file with your credentials before the cron job will work.${NC}"
    echo
fi

# Show current cron jobs
echo -e "${BLUE}📋 Current cron jobs for $(whoami):${NC}"
crontab -l 2>/dev/null || echo "No existing cron jobs found."
echo

# Ask for the schedule
echo -e "${BLUE}⏰ When would you like the script to run?${NC}"
echo "1) Daily at 5:00 PM (17:00) - Original schedule"
echo "2) Daily at a custom time"
echo "3) Weekly (choose day and time)"
echo "4) Custom cron expression"
echo

read -p "Choose option (1-4): " schedule_option

case $schedule_option in
    1)
        CRON_SCHEDULE="0 17 * * *"
        SCHEDULE_DESC="Daily at 5:00 PM"
        ;;
    2)
        read -p "Enter hour (0-23): " hour
        read -p "Enter minute (0-59): " minute
        CRON_SCHEDULE="$minute $hour * * *"
        SCHEDULE_DESC="Daily at $hour:$(printf "%02d" $minute)"
        ;;
    3)
        echo "Choose day of week:"
        echo "0) Sunday"
        echo "1) Monday"
        echo "2) Tuesday"
        echo "3) Wednesday"
        echo "4) Thursday"
        echo "5) Friday"
        echo "6) Saturday"
        read -p "Day (0-6): " day
        read -p "Enter hour (0-23): " hour
        read -p "Enter minute (0-59): " minute
        CRON_SCHEDULE="$minute $hour * * $day"
        SCHEDULE_DESC="Weekly on day $day at $hour:$(printf "%02d" $minute)"
        ;;
    4)
        read -p "Enter custom cron expression (minute hour day month weekday): " CRON_SCHEDULE
        SCHEDULE_DESC="Custom: $CRON_SCHEDULE"
        ;;
    *)
        echo -e "${RED}❌ Invalid option. Exiting.${NC}"
        exit 1
        ;;
esac

echo
echo -e "${GREEN}📅 Schedule: $SCHEDULE_DESC${NC}"
echo -e "${GREEN}🔧 Cron expression: $CRON_SCHEDULE${NC}"
echo

# Ask about start date
echo -e "${BLUE}📅 Optional: Set a start date?${NC}"
echo "You can set a future date when the cron job should start running."
read -p "Enter start date (YYYY-MM-DD) or press Enter to start immediately: " start_date

# Create the cron job entry
CRON_JOB="$CRON_SCHEDULE cd $PROJECT_DIR && $RUN_SCRIPT"

# Add start date environment variable if specified
if [ -n "$start_date" ]; then
    CRON_JOB="$CRON_SCHEDULE CRON_START_DATE=$start_date $RUN_SCRIPT"
    echo -e "${GREEN}📅 Start date set to: $start_date${NC}"
fi

echo
echo -e "${BLUE}🔧 Generated cron job entry:${NC}"
echo "$CRON_JOB"
echo

# Ask for confirmation
read -p "Do you want to add this cron job? (y/N): " confirm

if [[ $confirm =~ ^[Yy]$ ]]; then
    # Add the cron job
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Cron job added successfully!${NC}"
        echo
        echo -e "${BLUE}📋 Updated cron jobs:${NC}"
        crontab -l
        echo
        echo -e "${GREEN}🎉 Setup complete!${NC}"
        echo
        echo -e "${BLUE}📝 Next steps:${NC}"
        echo "1. Make sure your .env.local file exists with required credentials"
        echo "2. Test the script manually: $RUN_SCRIPT"
        echo "3. Check logs in: $PROJECT_DIR/logs/"
        echo "4. Latest log available at: $PROJECT_DIR/logs/earn-crowns_latest.log"
        echo
        echo -e "${BLUE}🛠  Useful commands:${NC}"
        echo "- View cron jobs: crontab -l"
        echo "- Remove cron jobs: crontab -r"
        echo "- Edit cron jobs: crontab -e"
        echo "- View latest log: tail -f $PROJECT_DIR/logs/earn-crowns_latest.log"
        echo "- Test script: $RUN_SCRIPT"
    else
        echo -e "${RED}❌ Failed to add cron job${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⏹  Cron job setup cancelled${NC}"
    echo
    echo -e "${BLUE}💡 To set up manually, add this line to your crontab (crontab -e):${NC}"
    echo "$CRON_JOB"
fi

echo
echo -e "${BLUE}📚 Additional notes:${NC}"
echo "- Logs are automatically cleaned up after 30 days"
echo "- The script checks for required environment variables before running"
echo "- Chrome browser data is shared between runs for faster startup"
echo "- reCAPTCHA solving is automated with TwoCaptcha service" 