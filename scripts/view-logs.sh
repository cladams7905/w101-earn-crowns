#!/bin/bash

# Wizard101 Earn Crowns - Log Viewer Script
# This script helps view and monitor the earn-crowns logs

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOGS_DIR="$PROJECT_DIR/logs"
LATEST_LOG="$LOGS_DIR/earn-crowns_latest.log"

echo -e "${BLUE}📋 Wizard101 Earn Crowns - Log Viewer${NC}"
echo -e "${BLUE}====================================${NC}"
echo

# Check if logs directory exists
if [ ! -d "$LOGS_DIR" ]; then
    echo -e "${YELLOW}⚠️  No logs directory found at $LOGS_DIR${NC}"
    echo -e "${YELLOW}   Run the script at least once to create logs.${NC}"
    exit 1
fi

# Function to show available log files
show_log_files() {
    echo -e "${BLUE}📁 Available log files:${NC}"
    local count=0
    for log_file in "$LOGS_DIR"/earn-crowns_*.log; do
        if [ -f "$log_file" ]; then
            local filename=$(basename "$log_file")
            local filesize=$(ls -lh "$log_file" | awk '{print $5}')
            local filedate=$(ls -l "$log_file" | awk '{print $6, $7, $8}')
            echo "   $filename ($filesize) - $filedate"
            ((count++))
        fi
    done
    
    if [ $count -eq 0 ]; then
        echo -e "${YELLOW}   No log files found${NC}"
    fi
    echo
}

# Show available options
echo -e "${BLUE}🔍 What would you like to do?${NC}"
echo "1) View latest log (real-time)"
echo "2) View latest log (static)"
echo "3) View all available log files"
echo "4) View specific log file"
echo "5) Search logs for text"
echo "6) Show log summary"
echo "7) Clear old logs"
echo

read -p "Choose option (1-7): " choice

case $choice in
    1)
        if [ -f "$LATEST_LOG" ]; then
            echo -e "${GREEN}📖 Following latest log (Ctrl+C to exit):${NC}"
            echo -e "${BLUE}File: $LATEST_LOG${NC}"
            echo
            tail -f "$LATEST_LOG"
        else
            echo -e "${RED}❌ Latest log file not found${NC}"
            exit 1
        fi
        ;;
    2)
        if [ -f "$LATEST_LOG" ]; then
            echo -e "${GREEN}📖 Latest log content:${NC}"
            echo -e "${BLUE}File: $LATEST_LOG${NC}"
            echo
            cat "$LATEST_LOG"
        else
            echo -e "${RED}❌ Latest log file not found${NC}"
            exit 1
        fi
        ;;
    3)
        show_log_files
        ;;
    4)
        show_log_files
        read -p "Enter log filename (or part of it): " log_pattern
        matching_logs=($(find "$LOGS_DIR" -name "*$log_pattern*" -type f))
        
        if [ ${#matching_logs[@]} -eq 0 ]; then
            echo -e "${RED}❌ No matching log files found${NC}"
            exit 1
        elif [ ${#matching_logs[@]} -eq 1 ]; then
            echo -e "${GREEN}📖 Viewing: ${matching_logs[0]}${NC}"
            echo
            cat "${matching_logs[0]}"
        else
            echo -e "${BLUE}Multiple matches found:${NC}"
            for i in "${!matching_logs[@]}"; do
                echo "$((i+1))) $(basename "${matching_logs[i]}")"
            done
            read -p "Select file (1-${#matching_logs[@]}): " file_choice
            if [[ $file_choice =~ ^[0-9]+$ ]] && [ $file_choice -ge 1 ] && [ $file_choice -le ${#matching_logs[@]} ]; then
                selected_file="${matching_logs[$((file_choice-1))]}"
                echo -e "${GREEN}📖 Viewing: $selected_file${NC}"
                echo
                cat "$selected_file"
            else
                echo -e "${RED}❌ Invalid selection${NC}"
                exit 1
            fi
        fi
        ;;
    5)
        read -p "Enter text to search for: " search_text
        echo -e "${GREEN}🔍 Searching for '$search_text' in all logs:${NC}"
        echo
        grep -n "$search_text" "$LOGS_DIR"/earn-crowns_*.log 2>/dev/null || echo "No matches found"
        ;;
    6)
        echo -e "${GREEN}📊 Log Summary:${NC}"
        echo
        
        # Count total log files
        log_count=$(ls -1 "$LOGS_DIR"/earn-crowns_*.log 2>/dev/null | wc -l)
        echo -e "${BLUE}Total log files:${NC} $log_count"
        
        # Show disk usage
        if [ $log_count -gt 0 ]; then
            total_size=$(du -sh "$LOGS_DIR" 2>/dev/null | cut -f1)
            echo -e "${BLUE}Total log size:${NC} $total_size"
            
            # Show oldest and newest
            oldest=$(ls -t "$LOGS_DIR"/earn-crowns_*.log 2>/dev/null | tail -1)
            newest=$(ls -t "$LOGS_DIR"/earn-crowns_*.log 2>/dev/null | head -1)
            
            if [ -n "$oldest" ]; then
                echo -e "${BLUE}Oldest log:${NC} $(basename "$oldest")"
            fi
            if [ -n "$newest" ]; then
                echo -e "${BLUE}Newest log:${NC} $(basename "$newest")"
            fi
            
            # Show recent success/failure patterns
            echo
            echo -e "${BLUE}Recent results (last 10 runs):${NC}"
            grep -h "completed successfully\|failed with exit code" "$LOGS_DIR"/earn-crowns_*.log 2>/dev/null | tail -10 | while read line; do
                if [[ $line == *"completed successfully"* ]]; then
                    echo -e "${GREEN}✅ $line${NC}"
                else
                    echo -e "${RED}❌ $line${NC}"
                fi
            done
        fi
        ;;
    7)
        echo -e "${YELLOW}🧹 This will delete log files older than 30 days${NC}"
        read -p "Are you sure? (y/N): " confirm
        if [[ $confirm =~ ^[Yy]$ ]]; then
            deleted_count=$(find "$LOGS_DIR" -name "earn-crowns_*.log" -type f -mtime +30 2>/dev/null | wc -l)
            find "$LOGS_DIR" -name "earn-crowns_*.log" -type f -mtime +30 -delete 2>/dev/null
            echo -e "${GREEN}✅ Deleted $deleted_count old log files${NC}"
        else
            echo -e "${YELLOW}⏹  Cleanup cancelled${NC}"
        fi
        ;;
    *)
        echo -e "${RED}❌ Invalid option${NC}"
        exit 1
        ;;
esac 