# Wizard101 Earn Crowns - Local macOS Cron Setup

This directory contains scripts to run the Wizard101 earn-crowns automation locally on macOS using cron jobs.

## 📁 Files

- **`run-earn-crowns.sh`** - Main script that runs the earn-crowns automation with logging
- **`setup-cron.sh`** - Interactive setup script to configure your cron job
- **`view-logs.sh`** - Log viewer script to monitor and analyze execution logs
- **`README-CRON.md`** - This documentation file

## 🚀 Quick Start

1. **Set up your environment variables** (if you haven't already):

   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials
   ```

2. **Run the interactive setup**:

   ```bash
   ./scripts/setup-cron.sh
   ```

3. **Test the script manually** (optional):

   ```bash
   ./scripts/run-earn-crowns.sh
   ```

4. **Monitor logs**:
   ```bash
   ./scripts/view-logs.sh
   ```

## 🔧 Manual Setup

If you prefer to set up the cron job manually:

1. Open your crontab:

   ```bash
   crontab -e
   ```

2. Add a line to run the script (example for daily at 5:00 PM):

   ```
   0 17 * * * cd /path/to/your/w101decksmith && ./scripts/run-earn-crowns.sh
   ```

3. Save and exit the editor.

## 📋 Required Environment Variables

Make sure your `.env.local` file contains:

```bash
# Wizard101 credentials
WIZARD101_USERNAME=your_username
WIZARD101_PASSWORD=your_password

# TwoCaptcha for automated CAPTCHA solving
TWO_CAPTCHA_API_KEY=your_twocaptcha_api_key

# Supabase for quiz data storage
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Optional: Google Gemini for AI-powered quiz answers
GEMINI_API_KEY=your_gemini_api_key

# Optional: Start date for the cron job
CRON_START_DATE=2024-01-01
```

## 📊 Logging

### Log Locations

- **Latest log**: `logs/earn-crowns_latest.log` (symlink to most recent)
- **All logs**: `logs/earn-crowns_YYYYMMDD_HHMMSS.log`

### Log Features

- ✅ Timestamped entries
- 🧹 Automatic cleanup (keeps 30 days)
- 📈 Execution statistics
- 🔍 Error tracking
- 💾 System information logging

### Viewing Logs

```bash
# Interactive log viewer
./scripts/view-logs.sh

# Quick commands
tail -f logs/earn-crowns_latest.log  # Follow latest log
cat logs/earn-crowns_latest.log      # View latest log
grep "Error" logs/*.log              # Search for errors
```

## ⏰ Cron Schedule Examples

```bash
# Daily at 5:00 PM
0 17 * * *

# Every Monday at 2:30 PM
30 14 * * 1

# Twice daily (9 AM and 9 PM)
0 9,21 * * *

# Every hour during business hours (9 AM - 5 PM, Mon-Fri)
0 9-17 * * 1-5
```

## 🛠 Troubleshooting

### Common Issues

**1. "Permission denied" errors**

```bash
chmod +x scripts/*.sh
```

**2. "Node.js not found" errors**

- Install Node.js from [nodejs.org](https://nodejs.org/)
- Or use Homebrew: `brew install node`

**3. "ts-node not found" errors**

```bash
npm install
```

**4. Cron job not running**

- Check if cron service is enabled: `sudo launchctl list | grep cron`
- Verify cron job is added: `crontab -l`
- Check system logs: `grep CRON /var/log/system.log`

**5. Environment variables not found**

- Ensure `.env.local` exists in project root
- Verify file permissions: `ls -la .env.local`
- Test manually: `./scripts/run-earn-crowns.sh`

### Debugging Steps

1. **Test the script manually**:

   ```bash
   ./scripts/run-earn-crowns.sh
   ```

2. **Check the logs**:

   ```bash
   ./scripts/view-logs.sh
   ```

3. **Verify cron job syntax**:

   ```bash
   crontab -l
   ```

4. **Check system requirements**:
   ```bash
   node --version
   npm --version
   which node
   which npm
   ```

### macOS-Specific Notes

- **Full Disk Access**: You may need to grant Terminal or your shell full disk access in System Preferences > Security & Privacy > Privacy > Full Disk Access

- **Background App Refresh**: Ensure cron/Terminal has permission to run in the background

- **Sleep/Wake**: Cron jobs may not run if your Mac is asleep. Consider:
  - Using `caffeinate` command
  - Scheduling during active hours
  - Using macOS's `pmset` to configure sleep behavior

## 📝 Monitoring & Maintenance

### Check Cron Job Status

```bash
# View all cron jobs
crontab -l

# Check recent cron activity
grep CRON /var/log/system.log | tail -10

# View latest execution
./scripts/view-logs.sh
```

### Regular Maintenance

- Review logs weekly for errors
- Update credentials if needed
- Clean old logs (automated every 30 days)
- Monitor disk space usage

### Performance Tips

- The script reuses Chrome user data for faster startup
- Quiz answers are cached in memory during execution
- Logs are automatically rotated and cleaned

## 🔐 Security Considerations

- Store credentials securely in `.env.local`
- Don't commit `.env.local` to version control
- Regularly rotate API keys
- Monitor logs for suspicious activity
- Use strong, unique passwords

## 📞 Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review the logs using `./scripts/view-logs.sh`
3. Test the script manually
4. Verify all environment variables are set correctly

Remember that this automation interacts with external services (Wizard101, TwoCaptcha, Supabase) which may have their own rate limits or service interruptions.
