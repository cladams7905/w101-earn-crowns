# Wizard101 Earn Crowns - Automated Quiz Bot

This is an automated bot that can earn you up to **one hundred crowns per day** in Wizard101 by completing trivia quizzes. The bot runs on your computer and can be scheduled to run automatically.

## 🎯 What This Does

- Automatically logs into your Wizard101 account
- Finds and completes trivia quizzes to earn crowns
- Remembers quiz answers for future use
- Can run on a schedule (like every day at a specific time)
- Stores all data locally on your computer

## 📋 What You'll Need

Before starting, make sure you have:

1. **A Wizard101 account** with login credentials
2. **A TwoCaptcha account** (for solving captchas automatically) - [Get one here](https://2captcha.com/)
   - **Cost:** About $1.50 per 1,000 captcha solves, minimum $3 deposit required
   - This is necessary because Wizard101 uses captchas to prevent bots
3. **A computer running macOS or Windows** This guide was originally built for MacOS users, but you can still run this script on Windows (see Windows setup notes below)
4. **Optional: Google Gemini API key** (for smarter quiz answers) - [Get one here](https://aistudio.google.com/)

## 🚀 Step-by-Step Setup Guide

### Step 1: Install Node.js

Node.js is the software that runs this bot. Here's how to install it:

1. Go to [nodejs.org](https://nodejs.org/)
2. Download the "LTS" version (the green button)
3. Open the downloaded file and follow the installer
4. When done, restart your computer

**To verify it worked:**

1. Open Terminal (press Cmd+Space, type "Terminal", press Enter)
2. Type: `node --version`
3. You should see something like "v20.10.0"

### Step 2: Download This Project

1. Click the green "Code" button at the top of this page
2. Click "Download ZIP"
3. Unzip the file to your Desktop (or wherever you want to keep it)
4. Rename the folder to something simple like "wizard101-bot"

### Step 3: Open Terminal and Navigate to the Project

1. Open Terminal (Cmd+Space, type "Terminal")
2. Type: `cd Desktop/wizard101-bot` (replace with your actual folder path)
3. Press Enter

**Tip:** You can drag the folder from Finder into Terminal to get the path automatically!

### Step 4: Install the Bot's Dependencies

Dependencies are extra pieces of code the bot needs to work. Install them by typing:

```bash
npm install
```

This might take a few minutes. You'll see lots of text scrolling by - that's normal!

### Step 5: Create Your Configuration File

The bot needs your login information. Here's how to set it up:

1. In the project folder, create a new file called `.env.local`
2. Open it with any text editor (TextEdit works fine)
3. Copy and paste this template:

```bash
# Your Wizard101 login information
WIZARD101_USERNAME=your_wizard101_username
WIZARD101_PASSWORD=your_wizard101_password

# TwoCaptcha API key for solving captchas automatically
TWO_CAPTCHA_API_KEY=your_twocaptcha_api_key

# Optional: Google Gemini for smarter quiz answers (get free API key at https://aistudio.google.com/)
GEMINI_API_KEY=

# Optional: When to start the cron job (leave as is)
CRON_START_DATE=2024-01-01
```

4. Replace the placeholder values:

   - `your_wizard101_username` → Your actual Wizard101 username
   - `your_wizard101_password` → Your actual Wizard101 password
   - `your_twocaptcha_api_key` → Your TwoCaptcha API key

5. **Optional: Set up Google Gemini for better quiz answers**

   - Go to [Google AI Studio](https://aistudio.google.com/)
   - Sign in with your Google account
   - Click "Get API key" and create a new key
   - Copy the API key and paste it after `GEMINI_API_KEY=` in your .env.local file
   - This helps the bot answer quiz questions more accurately (it's free!)

6. Save the file

**Important:**

- Don't share this file with anyone (it has your passwords!)
- Make sure the file is named exactly `.env.local` (with the dot at the beginning)

### Step 6: Test the Bot

Let's make sure everything works:

1. In Terminal, type: `npm run earn-crowns`
2. Press Enter

You should see the bot start up and try to log into Wizard101. If it works, you'll see messages about loading quiz data and navigating to the website.

**To stop the bot:** Press Ctrl+C in Terminal

## 🪟 Windows Users

This bot works on Windows too! You have a few options:

### Option 1: Git Bash (Recommended)

1. Install [Git for Windows](https://git-scm.com/download/win) (includes Git Bash)
2. Follow the setup guide above, but use **Git Bash** instead of Terminal
3. All commands work the same way in Git Bash

### Option 2: Windows Subsystem for Linux (WSL)

1. Install [WSL](https://docs.microsoft.com/en-us/windows/wsl/install)
2. Follow the setup guide above in your WSL terminal
3. Works exactly like on Mac/Linux

### Option 3: Command Prompt/PowerShell

1. Use regular Command Prompt or PowerShell for Node.js commands (`npm install`, `npm run earn-crowns`)
2. The bash scripts (`.sh` files) won't work directly, but you can run the bot manually

### Windows-Specific Notes:

- **Scheduling**: Instead of cron, use Windows Task Scheduler to run the bot automatically
- **File paths**: Use backslashes `\` or forward slashes `/` in paths
- **Permissions**: You might not need `chmod` commands (those are for Mac/Linux)

## 🎮 How to Use the Bot

### Running the Bot Manually

To run the bot whenever you want:

1. Open Terminal
2. Navigate to your project: `cd Desktop/wizard101-bot`
3. Run: `npm run earn-crowns`

### Debug Mode (Troubleshooting)

If the bot isn't working properly, you can run it in debug mode to see what's happening:

1. Run: `npm run debug`
2. This will:
   - Open a visible Chrome browser window so you can see what the bot is doing
   - Take screenshots at important steps (saved as `debug-*.png` files)
   - Show more detailed information in the terminal
   - Help you identify issues like login problems or reCAPTCHA challenges

**Note:** Debug mode is slower and shows the browser window, so only use it for troubleshooting.

### Setting Up Automatic Running (Cron Job)

To make the bot run automatically (like every day at 5 PM):

1. In Terminal, type: `./scripts/setup-cron.sh`
2. Follow the prompts to choose when you want it to run
3. The bot will now run automatically at your chosen time

### Viewing Logs

To see what the bot has been doing:

1. Type: `./scripts/view-logs.sh`
2. This shows you the bot's activity and any problems

## 📁 Quiz Data Storage

The bot automatically saves quiz answers in a file called `scripts/quiz-answers.json`. This means:

- The bot gets smarter over time as it learns more answers
- All data stays on your computer (nothing is sent to external servers)
- If you delete this file, the bot will start fresh

## 🛠 Troubleshooting

### "Permission denied" errors

Try this in Terminal:

```bash
chmod +x scripts/*.sh
```

### "Command not found" errors

This usually means Node.js isn't installed properly. Go back to Step 1.

### Bot can't find the .env.local file

Make sure:

- The file is named exactly `.env.local` (with the dot)
- It's in the same folder as the other project files
- You're running Terminal from the correct folder

### TwoCaptcha errors

- Make sure you have money in your TwoCaptcha account
- Double-check your API key is correct
- TwoCaptcha sometimes has delays - this is normal

### Bot gets stuck on captchas

This is normal. The bot will wait for TwoCaptcha to solve them automatically. If you have the paid TwoCaptcha service, it should work within 30-60 seconds.

### "Module not found" errors

Try running `npm install` again in Terminal.

## 🔐 Security & Safety

- **Keep your .env.local file private** - it contains your passwords
- **Don't run the bot too frequently** - Wizard101 might notice automated behavior
- **Monitor the bot occasionally** - make sure it's working correctly
- **Use strong passwords** - for both Wizard101 and TwoCaptcha accounts

## 📞 Need Help?

If you're stuck:

1. **Read the error messages** - they often tell you what's wrong
2. **Check the logs** with `./scripts/view-logs.sh`
3. **Try running the bot manually** to see what happens
4. **Make sure all your credentials are correct** in the .env.local file

## ⚠️ Important Notes

- This bot interacts with Wizard101, TwoCaptcha, and optionally Google Gemini
- These services may have rate limits or occasional downtime
- The bot stores all quiz data locally on your computer
- Use responsibly and follow Wizard101's terms of service

## Disclaimer

Remember that this automation interacts with external services (Wizard101, TwoCaptcha, Gemini) which may have their own rate limits or service interruptions. Quiz data is stored locally in `scripts/quiz-answers.json`.
