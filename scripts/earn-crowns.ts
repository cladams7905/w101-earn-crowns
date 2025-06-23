import { Page } from "puppeteer-core";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import * as readline from "readline";

// Import TwoCaptcha using the TypeScript-friendly package
import * as TwoCaptcha from "2captcha-ts";

// Check if we're in CI environment early for puppeteer selection
const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

// Use different puppeteer imports based on environment
let puppeteer: any;

if (!isCI) {
  // Local environment: Use puppeteer-extra with stealth plugin
  const puppeteerExtra = require("puppeteer-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");

  const stealthPlugin = StealthPlugin();

  // Optional: Log available and enabled evasions for debugging
  console.log("🛡️ Available stealth evasions:", [
    ...stealthPlugin.availableEvasions
  ]);
  console.log("✅ Enabled stealth evasions:", [
    ...stealthPlugin.enabledEvasions
  ]);

  // Add stealth plugin only for local environments
  puppeteerExtra.use(stealthPlugin);
  puppeteer = puppeteerExtra;
  console.log("🛡️ Stealth plugin enabled for local environment");
} else {
  // CI environment: Use regular puppeteer-core directly
  puppeteer = require("puppeteer-core");
  console.log(
    "🔧 Using puppeteer-core directly in CI environment to avoid session conflicts"
  );
}

// Load environment variables from .env.local
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

// Type definitions
interface QuizAnswer {
  question: string;
  answer: string;
}

interface Quiz {
  quiz: string;
  pathname: string;
  answers: QuizAnswer[];
}

// Type for tracking quiz statistics
interface QuizStats {
  questionsAttempted: number;
  questionsAnswered: number;
  questionsSkipped: number;
  randomAnswers: number;
  databaseAnswers: number;
  geminiAnswers: number;
}

// Global stats for all quizzes
const globalStats = {
  totalQuizzes: 0,
  totalQuestionsAttempted: 0,
  totalQuestionsAnswered: 0,
  totalQuestionsSkipped: 0,
  totalRandomAnswers: 0,
  totalDatabaseAnswers: 0,
  totalGeminiAnswers: 0,
  successfulQuizzes: 0
};

// Cache for quiz answers (fetched once per script run)
let cachedQuizAnswers: Quiz[] | null = null;

// Track if quiz answers have been updated (to sync back to local file)
let quizAnswersUpdated = false;

// Function to fetch quiz answers from local file
async function fetchQuizAnswers(): Promise<Quiz[]> {
  if (cachedQuizAnswers) {
    console.log("✅ Using cached quiz answers");
    return cachedQuizAnswers;
  }

  console.log("📥 Loading quiz answers from local file...");

  try {
    const quizAnswersPath = path.join(__dirname, "quiz-answers.json");

    // Check if file exists, if not create it with empty array
    if (!fs.existsSync(quizAnswersPath)) {
      console.log("📄 Creating new quiz-answers.json file...");
      fs.writeFileSync(quizAnswersPath, JSON.stringify([], null, 2));
    }

    // Read the quiz-answers.json file
    const fileContent = fs.readFileSync(quizAnswersPath, "utf-8");
    const quizAnswers = JSON.parse(fileContent) as Quiz[];

    // Validate the data structure
    if (!Array.isArray(quizAnswers)) {
      throw new Error("Invalid quiz answers format: expected an array");
    }

    // Basic validation of quiz structure
    for (const quiz of quizAnswers) {
      if (!quiz.quiz || !quiz.pathname || !Array.isArray(quiz.answers)) {
        throw new Error(
          `Invalid quiz structure for quiz: ${quiz.quiz || "unknown"}`
        );
      }
    }

    console.log(
      `✅ Successfully loaded ${quizAnswers.length} quizzes from local file`
    );

    // Cache the results
    cachedQuizAnswers = quizAnswers;
    return quizAnswers;
  } catch (error) {
    console.error("❌ Error loading quiz answers from local file:", error);
    throw error;
  }
}

// Function to update quiz answers in local file
async function updateQuizAnswersInLocalFile(): Promise<void> {
  if (!cachedQuizAnswers || !quizAnswersUpdated) {
    return;
  }

  console.log("📤 Updating quiz answers in local file...");

  try {
    const quizAnswersPath = path.join(__dirname, "quiz-answers.json");

    // Convert quiz answers to JSON string
    const jsonData = JSON.stringify(cachedQuizAnswers, null, 2);

    // Write the updated data to the file
    fs.writeFileSync(quizAnswersPath, jsonData);

    console.log("✅ Successfully updated quiz answers in local file");
    quizAnswersUpdated = false;
  } catch (error) {
    console.error("❌ Error updating quiz answers in local file:", error);
    throw error;
  }
}

// Function to query Google Gemini for unknown questions
async function queryGeminiForAnswer(
  question: string,
  availableAnswers: string[]
): Promise<string | null> {
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!geminiApiKey) {
    console.log("⚠️ No Gemini API key found - skipping AI answer lookup");
    return null;
  }

  if (availableAnswers.length === 0) {
    console.log("❌ No available answers to choose from");
    return null;
  }

  try {
    console.log("🤖 Querying Google Gemini for answer...");

    // Construct the prompt
    const answersText = availableAnswers
      .map((answer, index) => `${String.fromCharCode(65 + index)}. ${answer}`)
      .join("\n");

    const prompt = `Based on the following question, please pick the most correct answer from the selection below. Respond with ONLY the text of the correct answer (not the letter, not JSON, just the answer text itself).

Question: ${question}

Answer choices:
${answersText}

Respond with only the answer text that is most correct.`;

    // Helper function to make API call to a specific Gemini model
    const makeGeminiApiCall = async (modelName: string) => {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.1,
              topK: 1,
              topP: 1,
              maxOutputTokens: 256
            }
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          `Gemini API request failed: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      // Extract the response text
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!responseText) {
        throw new Error("No response text received from Gemini");
      }

      return responseText;
    };

    // Try Gemini 2.5 Flash first, fallback to 1.5 Flash if it fails
    let responseText;
    try {
      console.log("🤖 Trying Gemini 2.5 Flash...");
      responseText = await makeGeminiApiCall("gemini-2.5-flash");
      console.log("✅ Gemini 2.5 Flash succeeded");
    } catch (flash25Error) {
      console.log("⚠️ Gemini 2.5 Flash failed, trying 1.5 Flash fallback...");
      console.log("📝 2.5 Flash error:", (flash25Error as Error).message);

      try {
        responseText = await makeGeminiApiCall("gemini-1.5-flash");
        console.log("✅ Gemini 1.5 Flash fallback succeeded");
      } catch (flash15Error) {
        console.log("❌ Both Gemini models failed");
        console.log("📝 1.5 Flash error:", (flash15Error as Error).message);
        throw new Error(
          `Both Gemini models failed - 2.5 Flash: ${
            (flash25Error as Error).message
          }, 1.5 Flash: ${(flash15Error as Error).message}`
        );
      }
    }

    console.log("🤖 Raw Gemini response:", responseText);

    // Clean up the response text (remove any extra formatting, quotes, etc.)
    let cleanedResponse = responseText.trim();

    // Remove common formatting that might be added
    cleanedResponse = cleanedResponse.replace(/^["']|["']$/g, ""); // Remove quotes
    cleanedResponse = cleanedResponse.replace(/^[A-Z]\.\s*/, ""); // Remove "A. ", "B. ", etc.
    cleanedResponse = cleanedResponse.replace(/^\w+:\s*/, ""); // Remove "Answer: ", etc.
    cleanedResponse = cleanedResponse.trim();

    console.log("🧹 Cleaned Gemini response:", cleanedResponse);

    // Find the best matching answer from available options
    let bestMatch = null;
    let bestMatchScore = 0;

    for (const available of availableAnswers) {
      // Check for exact match (case insensitive)
      if (available.toLowerCase() === cleanedResponse.toLowerCase()) {
        bestMatch = available;
        bestMatchScore = 1.0;
        break;
      }

      // Check for substring matches in both directions
      const availableLower = available.toLowerCase();
      const responseLower = cleanedResponse.toLowerCase();

      if (
        availableLower.includes(responseLower) ||
        responseLower.includes(availableLower)
      ) {
        const matchScore =
          Math.max(
            responseLower.length / availableLower.length,
            availableLower.length / responseLower.length
          ) * 0.8; // Slight penalty for partial matches

        if (matchScore > bestMatchScore) {
          bestMatch = available;
          bestMatchScore = matchScore;
        }
      }

      // Check for word-based similarity for more complex answers
      const availableWords = availableLower
        .split(/\s+/)
        .filter((word) => word.length > 2);
      const responseWords = responseLower
        .split(/\s+/)
        .filter((word) => word.length > 2);

      if (availableWords.length > 0 && responseWords.length > 0) {
        let wordMatches = 0;
        for (const responseWord of responseWords) {
          for (const availableWord of availableWords) {
            if (
              responseWord === availableWord ||
              responseWord.includes(availableWord) ||
              availableWord.includes(responseWord)
            ) {
              wordMatches++;
              break;
            }
          }
        }

        const wordMatchScore =
          (wordMatches /
            Math.max(availableWords.length, responseWords.length)) *
          0.7;
        if (wordMatchScore > bestMatchScore && wordMatchScore > 0.5) {
          bestMatch = available;
          bestMatchScore = wordMatchScore;
        }
      }
    }

    if (!bestMatch) {
      console.log(
        `⚠️ Gemini response "${cleanedResponse}" doesn't match any available options: ${availableAnswers.join(
          ", "
        )}`
      );
      return null;
    }

    console.log(
      `✅ Gemini selected: "${cleanedResponse}" -> matched to: "${bestMatch}" (confidence: ${(
        bestMatchScore * 100
      ).toFixed(1)}%)`
    );
    return bestMatch;
  } catch (error) {
    console.error("❌ Error querying Gemini:", error);
    return null;
  }
}

// Function to add new answer to quiz data
function addAnswerToQuiz(quiz: Quiz, question: string, answer: string): void {
  const newAnswer: QuizAnswer = {
    question: question,
    answer: answer
  };

  quiz.answers.push(newAnswer);
  quizAnswersUpdated = true;

  console.log(
    `📝 Added new answer to quiz "${quiz.quiz}": "${question}" -> "${answer}"`
  );
}

// Function to randomly select n items from an array
function getRandomItems<T>(array: T[], n: number): T[] {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

// Function to handle reCAPTCHA challenges
async function handleReCaptchaChallenge(page: Page): Promise<void> {
  console.log("🔍 Looking for reCAPTCHA popup/modal...");

  // Wait a bit for potential popup to appear
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Check all frames for reCAPTCHA content
  const frames = await page.frames();
  console.log(`📱 Found ${frames.length} frames on the page`);

  // Log all frame URLs for debugging
  for (let i = 0; i < frames.length; i++) {
    try {
      const frameUrl = frames[i].url();
      console.log(`📱 Frame ${i}: ${frameUrl}`);
    } catch (e) {
      console.log(`📱 Frame ${i}: Unable to access URL`);
    }
  }

  let reCaptchaFrame = null;
  let reCaptchaSiteKey = null;

  // Look for frames that might contain reCAPTCHA
  for (const frame of frames) {
    try {
      const frameUrl = frame.url();
      console.log(`🔍 Checking frame: ${frameUrl}`);

      if (
        frameUrl.includes("recaptcha") ||
        frameUrl.includes("captcha") ||
        frameUrl.includes("verification") ||
        frameUrl.includes("/auth/popup/") ||
        frameUrl.includes("LoginWithCaptcha") ||
        frameUrl.includes("fpSessionAttribute") ||
        (frameUrl.includes("wizard101.com") && frameUrl !== page.url()) ||
        frameUrl !== page.url() // Any iframe could potentially contain captcha
      ) {
        console.log("✅ Found potential reCAPTCHA frame");
        reCaptchaFrame = frame;

        // Try to find site key in this frame or main page
        let frameCheck = await page.evaluate(() => {
          const recaptchaEl = document.querySelector("[data-sitekey]");
          const siteKey = recaptchaEl
            ? recaptchaEl.getAttribute("data-sitekey")
            : null;

          // Also check for site key in script tags
          const scripts = Array.from(document.querySelectorAll("script"));
          let scriptSiteKey = null;
          for (const script of scripts) {
            const content = script.textContent || "";
            const match = content.match(/sitekey['":\s]*['"]([^'"]+)['"]/i);
            if (match) {
              scriptSiteKey = match[1];
              break;
            }
          }

          // Look for reCAPTCHA checkbox that needs to be clicked
          const reCaptchaCheckbox = document.querySelector(
            ".recaptcha-checkbox, [role='checkbox'], .rc-anchor-checkbox, .recaptcha-checkbox-border"
          );

          return {
            siteKey: siteKey || scriptSiteKey,
            hasCheckbox: !!reCaptchaCheckbox,
            url: window.location.href
          };
        });

        // If we didn't find site key in main page, try to check inside the frame itself
        if (!frameCheck.siteKey && frame !== page.mainFrame()) {
          try {
            const frameInternalCheck = await frame.evaluate(() => {
              const recaptchaEl = document.querySelector("[data-sitekey]");
              const siteKey = recaptchaEl
                ? recaptchaEl.getAttribute("data-sitekey")
                : null;

              // Also check for site key in script tags within frame
              const scripts = Array.from(document.querySelectorAll("script"));
              let scriptSiteKey = null;
              for (const script of scripts) {
                const content = script.textContent || "";
                const match = content.match(/sitekey['":\s]*['"]([^'"]+)['"]/i);
                if (match) {
                  scriptSiteKey = match[1];
                  break;
                }
              }

              // Look for reCAPTCHA checkbox in frame
              const reCaptchaCheckbox = document.querySelector(
                ".recaptcha-checkbox, [role='checkbox'], .rc-anchor-checkbox, .recaptcha-checkbox-border"
              );

              return {
                siteKey: siteKey || scriptSiteKey,
                hasCheckbox: !!reCaptchaCheckbox,
                url: window.location.href
              };
            });

            if (frameInternalCheck.siteKey) {
              console.log(
                `🔑 Found site key inside frame: ${frameInternalCheck.siteKey}`
              );
              frameCheck = frameInternalCheck;
            }
          } catch (frameAccessError) {
            console.log(
              `⚠️ Could not access frame internals: ${frameAccessError.message}`
            );
          }
        }

        if (frameCheck.siteKey) {
          reCaptchaSiteKey = frameCheck.siteKey;
          console.log(`🔑 Found site key: ${reCaptchaSiteKey}`);

          // Check if this is a visible reCAPTCHA with checkbox
          if (frameCheck.hasCheckbox) {
            console.log("✅ Found visible reCAPTCHA with checkbox");

            // Try to click the "I'm not a robot" checkbox first
            try {
              console.log(
                "🖱️ Attempting to click 'I'm not a robot' checkbox..."
              );

              // Try clicking checkbox in main page first
              let checkboxClicked = await page.evaluate(() => {
                const checkboxSelectors = [
                  ".recaptcha-checkbox",
                  "[role='checkbox']",
                  ".rc-anchor-checkbox",
                  ".recaptcha-checkbox-border"
                ];

                for (const selector of checkboxSelectors) {
                  const checkbox = document.querySelector(selector);
                  if (checkbox) {
                    console.log(`🎯 Found checkbox with selector: ${selector}`);
                    (checkbox as HTMLElement).click();
                    return true;
                  }
                }
                return false;
              });

              // If not found in main page, try clicking in the frame
              if (
                !checkboxClicked &&
                reCaptchaFrame &&
                reCaptchaFrame !== page.mainFrame()
              ) {
                try {
                  console.log("🔄 Trying to click checkbox in frame...");
                  checkboxClicked = await reCaptchaFrame.evaluate(() => {
                    const checkboxSelectors = [
                      ".recaptcha-checkbox",
                      "[role='checkbox']",
                      ".rc-anchor-checkbox",
                      ".recaptcha-checkbox-border"
                    ];

                    for (const selector of checkboxSelectors) {
                      const checkbox = document.querySelector(selector);
                      if (checkbox) {
                        console.log(
                          `🎯 Found checkbox in frame with selector: ${selector}`
                        );
                        (checkbox as HTMLElement).click();
                        return true;
                      }
                    }
                    return false;
                  });
                } catch (frameClickError) {
                  console.log(
                    `⚠️ Could not click checkbox in frame: ${frameClickError.message}`
                  );
                }
              }

              if (checkboxClicked) {
                console.log("✅ Successfully clicked reCAPTCHA checkbox");

                // Wait for challenge to appear
                console.log("⏳ Waiting for visual challenge to appear...");
                await new Promise((resolve) => setTimeout(resolve, 3000));

                // Check if visual challenge appeared (this means we need TwoCaptcha)
                let challengeAppeared = await page.evaluate(() => {
                  return !!document.querySelector(
                    ".rc-imageselect, .rc-defaultchallenge, .rc-audiochallenge"
                  );
                });

                // Also check in frame if not found in main page
                if (
                  !challengeAppeared &&
                  reCaptchaFrame &&
                  reCaptchaFrame !== page.mainFrame()
                ) {
                  try {
                    challengeAppeared = await reCaptchaFrame.evaluate(() => {
                      return !!document.querySelector(
                        ".rc-imageselect, .rc-defaultchallenge, .rc-audiochallenge"
                      );
                    });
                  } catch (frameChallengeError) {
                    console.log(
                      `⚠️ Could not check challenge in frame: ${frameChallengeError.message}`
                    );
                  }
                }

                if (challengeAppeared) {
                  console.log(
                    "🎯 Visual challenge appeared, using TwoCaptcha..."
                  );
                } else {
                  console.log(
                    "✅ No visual challenge - checkbox was sufficient!"
                  );
                  return; // Exit function successfully
                }
              }
            } catch (checkboxError) {
              console.log("❌ Failed to click checkbox:", checkboxError);
            }
          }
          break; // Found the main reCAPTCHA frame
        }
      }
    } catch (frameError) {
      console.log(`⚠️ Could not access frame: ${frameError.message}`);
      continue;
    }
  }

  // If we found a site key, solve with TwoCaptcha
  if (reCaptchaSiteKey) {
    try {
      console.log("🤖 Using TwoCaptcha to solve reCAPTCHA...");

      const TwoCaptcha = await import("2captcha-ts");
      const solver = new TwoCaptcha.Solver(process.env.TWO_CAPTCHA_API_KEY!);

      console.log("⏳ Submitting reCAPTCHA to TwoCaptcha...");
      const result = await solver.recaptcha({
        pageurl: page.url(),
        googlekey: reCaptchaSiteKey,
        invisible: false // This is a visible reCAPTCHA
      });

      console.log("✅ TwoCaptcha solved the reCAPTCHA!");
      console.log(`📝 Token: ${result.data.substring(0, 50)}...`);

      // Inject the token into the page
      const injectionResult = await page.evaluate((token) => {
        try {
          // Set g-recaptcha-response in main page
          const responseField = document.getElementById(
            "g-recaptcha-response"
          ) as HTMLTextAreaElement;
          if (responseField) {
            responseField.value = token;
            responseField.innerHTML = token;
            console.log("✅ Token set in g-recaptcha-response field");
          }

          // Look for and call callback function
          if (typeof (window as any).reCaptchaCallback === "function") {
            console.log("📞 Calling reCaptchaCallback...");
            (window as any).reCaptchaCallback(token);
            return "callback_called";
          }

          // Try to submit any forms with the token
          const forms = document.querySelectorAll("form");
          for (const form of forms) {
            const submitButton = form.querySelector(
              "input[type='submit'], button[type='submit']"
            );
            if (submitButton) {
              console.log("🖱️ Clicking submit button...");
              (submitButton as HTMLElement).click();
              return "form_submitted";
            }
          }

          // Look for continue/close buttons in modals
          const continueButtons = [
            document.querySelector("button[onclick*='continue']"),
            document.querySelector("button[onclick*='close']"),
            document.querySelector(".btn-continue"),
            document.querySelector(".modal-close"),
            document.querySelector("[data-dismiss='modal']")
          ].filter(Boolean);

          if (continueButtons.length > 0) {
            console.log("🖱️ Clicking continue/close button...");
            (continueButtons[0] as HTMLElement).click();
            return "modal_closed";
          }

          return "token_injected";
        } catch (error) {
          return "error: " + (error as Error).message;
        }
      }, result.data);

      console.log("🎯 reCAPTCHA injection result:", injectionResult);

      // Wait for potential redirect or modal close after solving captcha
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (captchaError) {
      console.log("❌ Failed to solve reCAPTCHA:", captchaError);
      throw captchaError;
    }
  } else {
    console.log("❌ Could not find reCAPTCHA site key in any frame");

    // Fallback: Try using known site key for wizard101.com
    console.log("🔄 Attempting fallback with known Wizard101 site key...");

    try {
      const knownSiteKey = "6LfUFE0UAAAAAGoVniwSC9-MtgxlzzAb5dnr9WWY";
      console.log(`🔑 Using known site key: ${knownSiteKey}`);

      const TwoCaptcha = await import("2captcha-ts");
      const solver = new TwoCaptcha.Solver(process.env.TWO_CAPTCHA_API_KEY!);

      console.log("⏳ Submitting fallback reCAPTCHA to TwoCaptcha...");
      const result = await solver.recaptcha({
        pageurl: page.url(),
        googlekey: knownSiteKey,
        invisible: false // Assume visible reCAPTCHA
      });

      console.log("✅ TwoCaptcha solved fallback reCAPTCHA!");
      console.log(`📝 Token: ${result.data.substring(0, 50)}...`);

      // Inject the token into all possible locations
      const fallbackInjectionResult = await page.evaluate((token) => {
        try {
          let injected = false;

          // Set g-recaptcha-response in main page
          const responseField = document.getElementById(
            "g-recaptcha-response"
          ) as HTMLTextAreaElement;
          if (responseField) {
            responseField.value = token;
            responseField.innerHTML = token;
            console.log("✅ Fallback: Token set in g-recaptcha-response field");
            injected = true;
          }

          // Look for and call any callback functions
          const possibleCallbacks = [
            "reCaptchaCallback",
            "recaptchaCallback",
            "onRecaptchaCallback",
            "captchaCallback"
          ];

          for (const callbackName of possibleCallbacks) {
            if (typeof (window as any)[callbackName] === "function") {
              console.log(`📞 Fallback: Calling ${callbackName}...`);
              (window as any)[callbackName](token);
              injected = true;
            }
          }

          // Try to submit any forms with submit buttons
          const forms = document.querySelectorAll("form");
          for (const form of forms) {
            const submitButton = form.querySelector(
              "input[type='submit'], button[type='submit']"
            );
            if (submitButton) {
              console.log("🖱️ Fallback: Clicking submit button...");
              (submitButton as HTMLElement).click();
              injected = true;
            }
          }

          // Look for modal close/continue buttons
          const modalButtons = [
            document.querySelector("button[onclick*='continue']"),
            document.querySelector("button[onclick*='close']"),
            document.querySelector(".btn-continue"),
            document.querySelector(".modal-close"),
            document.querySelector("[data-dismiss='modal']")
          ].filter(Boolean);

          if (modalButtons.length > 0) {
            console.log("🖱️ Fallback: Clicking modal button...");
            (modalButtons[0] as HTMLElement).click();
            injected = true;
          }

          return injected ? "fallback_success" : "fallback_no_action";
        } catch (error) {
          return "fallback_error: " + (error as Error).message;
        }
      }, result.data);

      console.log("🎯 Fallback injection result:", fallbackInjectionResult);

      // Wait for potential redirect or modal close
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (fallbackError) {
      console.log("❌ Fallback reCAPTCHA solve failed:", fallbackError);
      throw fallbackError;
    }
  }
}

// Function to normalize text for better matching
function normalizeText(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      // Replace multiple underscores with a single placeholder
      .replace(/_+/g, " [BLANK] ")
      // Normalize whitespace
      .replace(/\s+/g, " ")
      // Remove common punctuation that might vary
      .replace(/[.,!?;:]/g, "")
      .trim()
  );
}

// Function to calculate text similarity for loose matching
function getTextSimilarity(text1: string, text2: string): number {
  const normalized1 = normalizeText(text1);
  const normalized2 = normalizeText(text2);

  // Simple word-based similarity
  const words1 = normalized1.split(" ").filter((word) => word.length > 2);
  const words2 = normalized2.split(" ").filter((word) => word.length > 2);

  if (words1.length === 0 || words2.length === 0) return 0;

  let matches = 0;
  for (const word1 of words1) {
    for (const word2 of words2) {
      if (word1.includes(word2) || word2.includes(word1)) {
        matches++;
        break;
      }
    }
  }

  return matches / Math.max(words1.length, words2.length);
}

// Function to find the answer for a given question in a quiz
async function findAnswerForQuestion(
  quiz: Quiz,
  questionText: string,
  availableAnswers: string[]
): Promise<{ answer: string | null; source: "database" | "gemini" | null }> {
  const normalizedQuestion = normalizeText(questionText);

  console.log(`🔍 Searching for question: "${questionText}"`);
  console.log(`🔍 Normalized: "${normalizedQuestion}"`);

  // STEP 1: Look for EXACT matches first (highest priority)
  const exactMatches: QuizAnswer[] = [];

  for (const answerObj of quiz.answers) {
    const normalizedQuizQuestion = normalizeText(answerObj.question);

    // True exact match (after normalization)
    if (normalizedQuizQuestion === normalizedQuestion) {
      exactMatches.push(answerObj);
      console.log(`✅ Found EXACT match: "${answerObj.question}"`);
    }
  }

  // If we have exact matches, prioritize them
  if (exactMatches.length > 0) {
    console.log(
      `🎯 Found ${exactMatches.length} exact match(es), checking answers...`
    );

    // Check which exact matches have valid answers available on the page
    const validExactMatches = exactMatches.filter((match) => {
      const candidateAnswer = match.answer;
      return availableAnswers.some(
        (available) =>
          available.toLowerCase().includes(candidateAnswer.toLowerCase()) ||
          candidateAnswer.toLowerCase().includes(available.toLowerCase())
      );
    });

    if (validExactMatches.length > 0) {
      const selectedMatch = validExactMatches[0]; // Use first valid exact match

      // Find the actual available answer text that matches
      const matchingAvailableAnswer = availableAnswers.find(
        (available) =>
          available
            .toLowerCase()
            .includes(selectedMatch.answer.toLowerCase()) ||
          selectedMatch.answer.toLowerCase().includes(available.toLowerCase())
      );

      if (matchingAvailableAnswer) {
        console.log(
          `✅ Selected EXACT match answer: "${selectedMatch.answer}" -> "${matchingAvailableAnswer}"`
        );
        return { answer: selectedMatch.answer, source: "database" };
      }
    } else {
      console.log(
        `⚠️ Found ${exactMatches.length} exact matches but none have valid answers for current page`
      );
      console.log(
        `Database answers were: ${exactMatches.map((m) => m.answer).join(", ")}`
      );
      console.log(`Page answers are: ${availableAnswers.join(", ")}`);
    }
  }

  // STEP 2: Look for substring matches (medium priority)
  const substringMatches: { question: QuizAnswer; similarity: number }[] = [];

  for (const answerObj of quiz.answers) {
    const normalizedQuizQuestion = normalizeText(answerObj.question);

    // Skip if we already found this as an exact match
    if (normalizedQuizQuestion === normalizedQuestion) {
      continue;
    }

    // Check for substring matching
    if (
      normalizedQuizQuestion.includes(normalizedQuestion) ||
      normalizedQuestion.includes(normalizedQuizQuestion)
    ) {
      substringMatches.push({ question: answerObj, similarity: 0.9 });
      console.log(`📝 Found substring match: "${answerObj.question}"`);
    }
  }

  if (substringMatches.length > 0) {
    console.log(
      `🔍 Found ${substringMatches.length} substring match(es), checking answers...`
    );

    // Check which substring matches have valid answers
    const validSubstringMatches = substringMatches.filter((match) => {
      const candidateAnswer = match.question.answer;
      return availableAnswers.some(
        (available) =>
          available.toLowerCase().includes(candidateAnswer.toLowerCase()) ||
          candidateAnswer.toLowerCase().includes(available.toLowerCase())
      );
    });

    if (validSubstringMatches.length > 0) {
      const bestSubstringMatch = validSubstringMatches[0];

      // Find the actual available answer text that matches
      const matchingAvailableAnswer = availableAnswers.find(
        (available) =>
          available
            .toLowerCase()
            .includes(bestSubstringMatch.question.answer.toLowerCase()) ||
          bestSubstringMatch.question.answer
            .toLowerCase()
            .includes(available.toLowerCase())
      );

      if (matchingAvailableAnswer) {
        console.log(
          `✅ Selected substring match answer: "${bestSubstringMatch.question.answer}" -> "${matchingAvailableAnswer}"`
        );
        return {
          answer: bestSubstringMatch.question.answer,
          source: "database"
        };
      }
    }
  }

  // STEP 3: Look for similarity-based matches (lowest priority)
  const similarityMatches: { question: QuizAnswer; similarity: number }[] = [];

  for (const answerObj of quiz.answers) {
    const normalizedQuizQuestion = normalizeText(answerObj.question);

    // Skip if we already processed this question
    if (
      normalizedQuizQuestion === normalizedQuestion ||
      normalizedQuizQuestion.includes(normalizedQuestion) ||
      normalizedQuestion.includes(normalizedQuizQuestion)
    ) {
      continue;
    }

    // Check similarity-based matching for fill-in-the-blank questions
    const similarity = getTextSimilarity(questionText, answerObj.question);
    if (similarity > 0.6) {
      // 60% similarity threshold
      similarityMatches.push({ question: answerObj, similarity });
      console.log(
        `🔄 Found similarity match (${(similarity * 100).toFixed(1)}%): "${
          answerObj.question
        }"`
      );
    }
  }

  if (similarityMatches.length > 0) {
    console.log(
      `🔄 Found ${similarityMatches.length} similarity match(es), checking answers...`
    );

    // Sort by similarity (highest first)
    similarityMatches.sort((a, b) => b.similarity - a.similarity);

    // Check which similarity matches have valid answers
    const validSimilarityMatches = similarityMatches.filter((match) => {
      const candidateAnswer = match.question.answer;
      return availableAnswers.some(
        (available) =>
          available.toLowerCase().includes(candidateAnswer.toLowerCase()) ||
          candidateAnswer.toLowerCase().includes(available.toLowerCase())
      );
    });

    if (validSimilarityMatches.length > 0) {
      const bestSimilarityMatch = validSimilarityMatches[0];

      // Find the actual available answer text that matches
      const matchingAvailableAnswer = availableAnswers.find(
        (available) =>
          available
            .toLowerCase()
            .includes(bestSimilarityMatch.question.answer.toLowerCase()) ||
          bestSimilarityMatch.question.answer
            .toLowerCase()
            .includes(available.toLowerCase())
      );

      if (matchingAvailableAnswer) {
        console.log(
          `✅ Selected similarity match answer: "${
            bestSimilarityMatch.question.answer
          }" -> "${matchingAvailableAnswer}" (${(
            bestSimilarityMatch.similarity * 100
          ).toFixed(1)}%)`
        );
        return {
          answer: bestSimilarityMatch.question.answer,
          source: "database"
        };
      }
    }
  }

  // STEP 4: No matches found in database, try Gemini
  console.log("❌ No matching questions found in database, trying Gemini...");

  const geminiAnswer = await queryGeminiForAnswer(
    questionText,
    availableAnswers
  );

  if (geminiAnswer) {
    // Add the new answer to the quiz data
    addAnswerToQuiz(quiz, questionText, geminiAnswer);
    return { answer: geminiAnswer, source: "gemini" };
  }

  return { answer: null, source: null };
}

// Function to debug cursor visibility issues
async function debugCursorVisibility(page: Page): Promise<void> {
  try {
    const cursorInfo = await page.evaluate(() => {
      const body = document.body;
      const computedStyle = window.getComputedStyle(body);

      return {
        bodyCursor: body.style.cursor,
        computedCursor: computedStyle.cursor,
        hasHiddenCursor: computedStyle.cursor === "none",
        bodyDisplay: computedStyle.display,
        bodyVisibility: computedStyle.visibility,
        userSelect: computedStyle.userSelect,
        pointerEvents: computedStyle.pointerEvents
      };
    });

    console.log("🔍 Cursor debug info:", cursorInfo);

    if (cursorInfo.hasHiddenCursor) {
      console.log("⚠️ Hidden cursor detected! Attempting to fix...");
      await ensureCursorVisibility(page);
    }
  } catch (error) {
    console.log("⚠️ Cursor debug failed:", error);
  }
}

// Function to ensure cursor visibility is maintained
async function ensureCursorVisibility(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      // Force cursor to be visible
      document.body.style.cursor = "auto";

      // Remove any styles that might hide the cursor
      const style = document.createElement("style");
      style.textContent = `
        * {
          cursor: auto !important;
        }
        button:hover, input[type="submit"]:hover, input[type="button"]:hover, a:hover {
          cursor: pointer !important;
        }
      `;

      // Remove existing similar styles first
      const existingStyles = document.querySelectorAll(
        "style[data-cursor-fix]"
      );
      existingStyles.forEach((s) => s.remove());

      style.setAttribute("data-cursor-fix", "true");
      document.head.appendChild(style);
    });
  } catch (error) {
    console.log("⚠️ Failed to ensure cursor visibility:", error);
  }
}

async function answerQuiz(page: Page, quiz: Quiz): Promise<boolean> {
  const quizStats: QuizStats = {
    questionsAttempted: 0,
    questionsAnswered: 0,
    questionsSkipped: 0,
    randomAnswers: 0,
    databaseAnswers: 0,
    geminiAnswers: 0
  };

  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎯 STARTING QUIZ: ${quiz.quiz}`);
    console.log(`📁 Path: ${quiz.pathname}`);
    console.log(`${"=".repeat(60)}`);

    // Navigate to the quiz page
    const quizUrl = `https://www.wizard101.com/quiz/trivia/game${quiz.pathname}`;
    console.log(`🌐 Navigating to: ${quizUrl}`);

    try {
      await page.goto(quizUrl, { waitUntil: "networkidle0", timeout: 30000 });
    } catch (navigationError) {
      console.log(`❌ Failed to navigate to quiz: ${navigationError}`);
      console.log(`🔄 Skipping this quiz due to navigation failure`);
      return false;
    }

    // Ensure cursor visibility after navigation
    await ensureCursorVisibility(page);

    // Wait a few seconds for the page to fully render
    console.log("⏳ Waiting for page to render...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if quiz loaded properly by looking for essential elements
    const quizLoadCheck = await page.evaluate(() => {
      // Check for quiz-specific elements that indicate successful loading
      const hasQuizContainer = !!document.querySelector(
        ".quizContainer, .quiz-container, #quiz"
      );
      const hasQuizQuestion = !!document.querySelector(".quizQuestion");
      const hasAnswers = !!document.querySelector(".answer");
      const hasError =
        !!document.querySelector(".error, .not-found") ||
        document.title.toLowerCase().includes("404") ||
        document.title.toLowerCase().includes("not found") ||
        document.title.toLowerCase().includes("error");
      const isLoginPage =
        document.URL.includes("/login") ||
        !!document.querySelector("#loginUserName");

      return {
        hasQuizContainer,
        hasQuizQuestion,
        hasAnswers,
        hasError,
        isLoginPage,
        url: window.location.href,
        title: document.title
      };
    });

    console.log("🔍 Quiz load check:", quizLoadCheck);

    // Determine if quiz loaded successfully
    if (quizLoadCheck.hasError || quizLoadCheck.isLoginPage) {
      console.log(
        `❌ Quiz failed to load properly: ${
          quizLoadCheck.hasError ? "Error page detected" : "Redirected to login"
        }`
      );

      // If redirected to login, this means authentication failed
      // Check for reCAPTCHA that might need to be solved
      if (quizLoadCheck.isLoginPage) {
        console.log(
          "🔍 Login required - checking for reCAPTCHA verification..."
        );

        // Wait a moment for potential reCAPTCHA popup to appear
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Check for reCAPTCHA elements that might have appeared
        const reCaptchaCheck = await page.evaluate(() => {
          // Check for reCAPTCHA elements
          const reCaptchaElements = [
            document.querySelector(".g-recaptcha"),
            document.querySelector("#g-recaptcha-response"),
            document.querySelector("[data-sitekey]"),
            document.querySelector("iframe[src*='recaptcha']"),
            document.querySelector("iframe[title*='recaptcha']"),
            document.querySelector("iframe[title*='captcha']")
          ].filter(Boolean);

          // Check for any popup/modal that might contain verification
          const popups = [
            document.querySelector(".modal"),
            document.querySelector(".popup"),
            document.querySelector(".overlay"),
            document.querySelector("[class*='modal']"),
            document.querySelector("[class*='popup']"),
            document.querySelector("[style*='position: fixed']")
          ].filter(Boolean);

          // Check all iframes for potential verification content
          const iframes = Array.from(document.querySelectorAll("iframe"));
          const suspiciousIframes = iframes.filter((iframe) => {
            const src = iframe.src || "";
            const title = iframe.title || "";
            return (
              src.includes("captcha") ||
              src.includes("recaptcha") ||
              src.includes("verification") ||
              src.includes("/auth/popup/") ||
              src.includes("LoginWithCaptcha") ||
              title.toLowerCase().includes("captcha") ||
              title.toLowerCase().includes("verification")
            );
          });

          return {
            reCaptchaCount: reCaptchaElements.length,
            popupCount: popups.length,
            suspiciousIframes: suspiciousIframes.length,
            frameUrls: iframes.map((iframe) => iframe.src || "no-src")
          };
        });

        console.log("🔍 reCAPTCHA check on login redirect:", reCaptchaCheck);

        if (
          reCaptchaCheck.reCaptchaCount > 0 ||
          reCaptchaCheck.popupCount > 0 ||
          reCaptchaCheck.suspiciousIframes > 0
        ) {
          console.log(
            "🤖 Found reCAPTCHA on login redirect - attempting to solve..."
          );

          try {
            // Handle the reCAPTCHA similar to post-login verification
            await handleReCaptchaChallenge(page);

            // After solving, wait and try to navigate to the quiz again
            console.log("🔄 reCAPTCHA solved, retrying quiz navigation...");
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Retry navigation to this quiz
            await page.goto(quizUrl, {
              waitUntil: "networkidle0",
              timeout: 30000
            });

            // Re-check if quiz loaded properly
            const retryCheck = await page.evaluate(() => {
              const hasQuizQuestion = !!document.querySelector(".quizQuestion");
              const hasAnswers = !!document.querySelector(".answer");
              const isLoginPage = !!document.querySelector("#loginUserName");

              return {
                hasQuizQuestion,
                hasAnswers,
                isLoginPage,
                url: window.location.href,
                title: document.title
              };
            });

            console.log("🔍 Retry check after reCAPTCHA:", retryCheck);

            if (
              !retryCheck.isLoginPage &&
              (retryCheck.hasQuizQuestion || retryCheck.hasAnswers)
            ) {
              console.log("✅ Quiz loaded successfully after reCAPTCHA solve!");
              // Continue with the quiz - don't return false
            } else {
              console.log("❌ Quiz still not accessible after reCAPTCHA solve");
              return false;
            }
          } catch (recaptchaError) {
            console.log("❌ Failed to solve reCAPTCHA:", recaptchaError);
            return false;
          }
        } else {
          console.log(
            "❌ No reCAPTCHA found - login may have failed for other reasons"
          );
          return false;
        }
      } else {
        console.log(`🔄 Skipping this quiz due to loading failure`);
        return false;
      }
    }

    // If we don't see quiz elements, wait a bit longer and check again
    if (!quizLoadCheck.hasQuizQuestion && !quizLoadCheck.hasAnswers) {
      console.log("⏳ Quiz elements not found immediately, waiting longer...");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const secondCheck = await page.evaluate(() => {
        return {
          hasQuizQuestion: !!document.querySelector(".quizQuestion"),
          hasAnswers: !!document.querySelector(".answer"),
          hasError:
            !!document.querySelector(".error, .not-found") ||
            document.title.toLowerCase().includes("404") ||
            document.title.toLowerCase().includes("not found") ||
            document.title.toLowerCase().includes("error")
        };
      });

      if (
        secondCheck.hasError ||
        (!secondCheck.hasQuizQuestion && !secondCheck.hasAnswers)
      ) {
        console.log(`❌ Quiz still not loading properly after extended wait`);
        console.log(`🔄 Skipping this quiz due to persistent loading issues`);
        return false;
      }
    }

    console.log("✅ Quiz appears to have loaded successfully");

    let questionNumber = 1;
    let shouldContinue = true;
    const maxQuestionsPerQuiz = 20; // Safety limit to prevent infinite loops

    while (shouldContinue && questionNumber <= maxQuestionsPerQuiz) {
      try {
        // Ensure cursor visibility before each question
        await ensureCursorVisibility(page);

        // Debug cursor if there are click issues
        if (questionNumber === 1) {
          await debugCursorVisibility(page);
        }

        // Check if quiz is complete before waiting for question
        const quizComplete = await page.evaluate(() => {
          // Check for quiz completion indicators
          const completionIndicators = [
            ".quizTitle",
            ".quiz-complete",
            ".quiz-finished",
            "YOU FINISHED",
            "CLAIM YOUR REWARD"
          ];

          for (const indicator of completionIndicators) {
            const element = document.querySelector(indicator);
            if (element && element.textContent?.includes("FINISHED")) {
              return true;
            }
          }

          // Check if there's no quiz question element
          const quizQuestion = document.querySelector(".quizQuestion");
          return !quizQuestion;
        });

        if (quizComplete) {
          console.log("🏁 Quiz appears to be complete!");
          shouldContinue = false;
          break;
        }

        // Wait for the quiz question to load with timeout
        try {
          await page.waitForSelector(".quizQuestion", { timeout: 5000 });
        } catch (timeoutError) {
          console.log(
            "⏰ No quiz question found, checking if quiz is complete..."
          );

          // Double-check for completion
          const isComplete = await page.evaluate(() => {
            const title = document.querySelector(".quizTitle");
            const claimButton = document.querySelector(
              'a[onclick*="openIframeSecure"]'
            );
            return (
              (title && title.textContent?.includes("FINISHED")) ||
              !!claimButton
            );
          });

          if (isComplete) {
            console.log("✅ Quiz completed successfully!");
            shouldContinue = false;
            break;
          } else {
            console.log(
              "❌ Timeout waiting for quiz question and no completion detected"
            );
            throw timeoutError;
          }
        }

        quizStats.questionsAttempted++;

        // Get the question text
        const questionText = await page.$eval(
          ".quizQuestion",
          (el: Element) => el.textContent?.trim() || ""
        );

        console.log(`\n📝 QUESTION ${questionNumber}:`);
        console.log(`❓ ${questionText}`);
        console.log(`${"-".repeat(50)}`);

        // Get all available answers from the page
        const answerElements = await page.$$(".answer");
        const availableAnswers: string[] = [];

        for (const answerElement of answerElements) {
          const answerText = await page.evaluate((el: Element) => {
            const textElement = el.querySelector(".answerText");
            return textElement ? textElement.textContent?.trim() || "" : "";
          }, answerElement);
          if (answerText) {
            availableAnswers.push(answerText);
          }
        }

        console.log(`📋 Available answers:`);
        availableAnswers.forEach((answer, index) => {
          console.log(`   ${String.fromCharCode(65 + index)}. ${answer}`);
        });

        // Find the correct answer by comparing with available options
        const correctAnswer = await findAnswerForQuestion(
          quiz,
          questionText,
          availableAnswers
        );

        let selectedAnswer: string;
        let isRandomSelection = false;

        if (!correctAnswer.answer) {
          console.log(
            `❌ Could not find answer for this question in quiz data`
          );
          console.log(`🎲 Selecting random answer from available options...`);

          // Select a random answer from available options
          const randomIndex = Math.floor(
            Math.random() * availableAnswers.length
          );
          selectedAnswer = availableAnswers[randomIndex];
          isRandomSelection = true;

          console.log(
            `🎯 Randomly selected: "${selectedAnswer}" (option ${String.fromCharCode(
              65 + randomIndex
            )})`
          );
        } else {
          selectedAnswer = correctAnswer.answer;
          console.log(`✅ Selected answer: "${selectedAnswer}"`);
        }

        // Find and click the selected answer using the largecheckbox element
        let answerClicked = false;
        for (const answerElement of answerElements) {
          const answerText = await page.evaluate((el: Element) => {
            const textElement = el.querySelector(".answerText");
            return textElement ? textElement.textContent?.trim() || "" : "";
          }, answerElement);

          // Improved matching logic - must find the exact selected answer
          const isMatch =
            answerText.toLowerCase().trim() ===
              selectedAnswer.toLowerCase().trim() ||
            answerText.toLowerCase().includes(selectedAnswer.toLowerCase()) ||
            selectedAnswer.toLowerCase().includes(answerText.toLowerCase());

          if (isMatch) {
            console.log(
              `🖱️  Found matching answer text: "${answerText}" for selected "${selectedAnswer}"`
            );

            // Retry logic for clicking the answer
            let clickAttempts = 0;
            const maxAttempts = 3;

            while (!answerClicked && clickAttempts < maxAttempts) {
              clickAttempts++;
              console.log(
                `🔄 Attempt ${clickAttempts}/${maxAttempts} to click answer...`
              );

              try {
                // Wait longer for DOM to stabilize and animations to complete
                await new Promise((resolve) => setTimeout(resolve, 1000));

                // Check if selectQuizAnswer function is available
                const functionAvailable = await page.evaluate(() => {
                  return (
                    typeof (window as unknown as Record<string, unknown>)
                      .selectQuizAnswer === "function"
                  );
                });

                if (!functionAvailable) {
                  console.log(
                    "⚠️ selectQuizAnswer function not available yet, waiting..."
                  );
                  await new Promise((resolve) => setTimeout(resolve, 2000));
                }

                // Simple wait instead of complex animation checking that causes TypeScript issues
                await new Promise((resolve) => setTimeout(resolve, 1000));

                console.log("✅ Animations complete, element should be ready");

                // Method 1: Try direct Puppeteer click first (simplest approach)
                console.log("🎯 Trying direct Puppeteer click on checkbox...");
                try {
                  const checkboxSelectors = [
                    ".answerBox .largecheckbox",
                    ".largecheckbox",
                    "a[name='checkboxtag']",
                    "a[onclick*='selectQuizAnswer']"
                  ];

                  let directClickSuccess = false;
                  for (const selector of checkboxSelectors) {
                    const checkboxElement = await answerElement.$(selector);
                    if (checkboxElement) {
                      console.log(
                        `✅ Found checkbox with selector: ${selector}`
                      );

                      // Check if element is visible and clickable
                      const isClickable = await checkboxElement.evaluate(
                        (el) => {
                          const rect = el.getBoundingClientRect();
                          const style = window.getComputedStyle(el);
                          return (
                            rect.width > 0 &&
                            rect.height > 0 &&
                            style.visibility !== "hidden" &&
                            style.display !== "none" &&
                            style.pointerEvents !== "none"
                          );
                        }
                      );

                      if (isClickable) {
                        await checkboxElement.click();
                        console.log("✅ Direct Puppeteer click executed!");

                        // Wait a moment and check if answer was selected
                        await new Promise((resolve) =>
                          setTimeout(resolve, 500)
                        );

                        const wasSelected = await page.evaluate((answerDiv) => {
                          const radioInput = answerDiv.querySelector(
                            'input[type="radio"]'
                          );
                          const checkbox =
                            answerDiv.querySelector(".largecheckbox");

                          // Check if radio is selected or if checkbox has selected styling
                          return (
                            (radioInput && (radioInput as any).checked) ||
                            (checkbox &&
                              checkbox.classList.contains("selected")) ||
                            (checkbox &&
                              checkbox.classList.contains("checked")) ||
                            answerDiv.classList.contains("selected")
                          );
                        }, answerElement);

                        if (wasSelected) {
                          console.log("✅ Answer selection confirmed!");
                          answerClicked = true;
                          directClickSuccess = true;
                          break;
                        } else {
                          console.log(
                            "⚠️ Click executed but selection not confirmed"
                          );
                        }
                      } else {
                        console.log("❌ Element found but not clickable");
                      }
                    }
                  }

                  if (directClickSuccess) {
                    break; // Exit the retry loop
                  } else {
                    console.log(
                      "❌ No checkbox found with direct selectors, trying JavaScript..."
                    );
                  }
                } catch (directClickError) {
                  console.log(
                    "❌ Direct Puppeteer click failed:",
                    directClickError
                  );
                }

                // Method 2: Skip the complex JavaScript evaluation - it's causing __name errors
                // The final fallback method works fine, so we'll rely on that instead
                console.log(
                  "🔄 Skipping complex evaluation to avoid errors..."
                );

                // If neither method worked, wait before retry
                if (!answerClicked && clickAttempts < maxAttempts) {
                  console.log("⏳ Waiting before retry...");
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                }
              } catch (error) {
                console.log(`❌ Attempt ${clickAttempts} error:`, error);

                if (clickAttempts < maxAttempts) {
                  console.log("⏳ Waiting before retry...");
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                }
              }
            }

            // Final fallback: Try old Puppeteer method if all retries failed
            if (!answerClicked) {
              try {
                console.log(
                  "🔄 Final fallback: Trying original Puppeteer approach..."
                );
                const checkboxElement = await answerElement.$(
                  ".answerBox .largecheckbox"
                );
                if (checkboxElement) {
                  await checkboxElement.click();
                  answerClicked = true;
                  console.log("✅ Answer clicked with final fallback method");
                } else {
                  console.log(
                    "❌ Final fallback also failed - no checkbox element found"
                  );
                }
              } catch (fallbackError) {
                console.log("❌ Final fallback error:", fallbackError);
              }
            }

            if (answerClicked) {
              quizStats.questionsAnswered++;

              // Log whether this was a correct answer or a random guess
              if (isRandomSelection) {
                console.log("🎲 Answer selected randomly (unknown question)");
                quizStats.randomAnswers++;
              } else if (correctAnswer.source === "gemini") {
                console.log("🤖 Answer selected using Gemini AI");
                quizStats.geminiAnswers++;
              } else {
                console.log("🎯 Answer selected from quiz database");
                quizStats.databaseAnswers++;
              }

              // Wait a bit for the answer to be processed
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
            break;
          }
        }

        if (!answerClicked) {
          console.log(
            `❌ Could not click answer - answer not found in available options`
          );
          console.log(`🔍 Attempted to find: "${selectedAnswer}"`);
          console.log(
            `📋 Available options were: ${availableAnswers.join(", ")}`
          );

          // If we can't find the selected answer, try clicking the first available option as a fallback
          if (answerElements.length > 0 && !isRandomSelection) {
            console.log(
              `🎲 Emergency fallback: trying to click first available option...`
            );
            try {
              const firstAnswerText = await page.evaluate((el: Element) => {
                const textElement = el.querySelector(".answerText");
                return textElement ? textElement.textContent?.trim() || "" : "";
              }, answerElements[0]);

              console.log(
                `🎯 Attempting emergency click on: "${firstAnswerText}"`
              );

              // Try direct click on first option
              const emergencyClickSuccess = await page.evaluate((answerDiv) => {
                try {
                  const checkboxLink = answerDiv.querySelector(
                    "a[name='checkboxtag']"
                  );
                  if (checkboxLink) {
                    (checkboxLink as any).click();
                    return true;
                  }
                  return false;
                } catch {
                  return false;
                }
              }, answerElements[0]);

              if (emergencyClickSuccess) {
                console.log("✅ Emergency fallback click successful");
                answerClicked = true;
                quizStats.questionsAnswered++;
                quizStats.randomAnswers++;
              } else {
                console.log("❌ Emergency fallback also failed");
                quizStats.questionsSkipped++;
              }
            } catch (emergencyError) {
              console.log("❌ Emergency fallback error:", emergencyError);
              quizStats.questionsSkipped++;
            }
          } else {
            quizStats.questionsSkipped++;
          }
        }

        // Enhanced next button clicking
        try {
          console.log("🔄 Looking for next question button...");

          // Wait a moment to let any answer processing complete
          await new Promise((resolve) => setTimeout(resolve, 300));

          // Use only the reliable #nextQuestion selector
          const nextButtonSelector = "#nextQuestion";

          try {
            // Check if the button exists and is visible
            const buttonExists = await page.evaluate((sel) => {
              try {
                const btn = document.querySelector(sel);
                return btn && (btn as any).offsetParent !== null;
              } catch {
                return false;
              }
            }, nextButtonSelector);

            if (buttonExists) {
              console.log(
                `📍 Found next button with selector: ${nextButtonSelector}`
              );

              // Wait for the button to be clickable
              await page.waitForSelector(nextButtonSelector, { timeout: 3000 });

              // Enhanced clicking for next button with better error handling
              let buttonClicked = false;

              // Try JavaScript click first to avoid navigation context issues
              try {
                await page.evaluate((sel) => {
                  try {
                    const btn = document.querySelector(sel);
                    if (btn) {
                      (btn as any).click();
                    }
                  } catch {
                    // Ignore errors during navigation
                  }
                }, nextButtonSelector);

                console.log("➡️  Next button clicked (JavaScript)");
                buttonClicked = true;
              } catch (jsError) {
                console.log(
                  "❌ JavaScript click failed, trying physical click:",
                  (jsError as Error).message
                );

                // Physical click fallback (less reliable during navigation)
                try {
                  await page.click(nextButtonSelector, { delay: 50 });
                  console.log("➡️  Next button clicked (Physical)");
                  buttonClicked = true;
                } catch (physicalError) {
                  // Don't log as error if it's navigation-related
                  const errorMsg = (physicalError as Error).message;
                  if (
                    errorMsg.includes("Execution context was destroyed") ||
                    errorMsg.includes("navigation")
                  ) {
                    console.log(
                      "🔄 Navigation in progress - click may have succeeded"
                    );
                    buttonClicked = true; // Assume success if navigation started
                  } else {
                    console.log("❌ Physical click failed:", errorMsg);
                  }
                }
              }

              if (buttonClicked) {
                // Wait for the next page to render, but handle navigation gracefully
                try {
                  await new Promise((resolve) => setTimeout(resolve, 2000));

                  // Check if we're still on a quiz page or if navigation happened
                  const stillOnQuiz = await page.evaluate(() => {
                    try {
                      return !!document.querySelector(
                        ".quizQuestion, .quizTitle"
                      );
                    } catch {
                      return false;
                    }
                  });

                  if (!stillOnQuiz) {
                    console.log(
                      "🏁 Navigation detected - quiz may be complete"
                    );
                    shouldContinue = false;
                  }
                } catch {
                  // Navigation errors are expected
                  console.log("🔄 Navigation completed");
                }

                // Continue to next question
                questionNumber++;
              } else {
                console.log("❌ Could not click next button");
                shouldContinue = false;
              }
            } else {
              console.log(
                "🏁 No next question button found - quiz may be complete"
              );
              shouldContinue = false;
            }
          } catch (selectorError) {
            console.log(
              `❌ Error with next button selector:`,
              (selectorError as Error).message
            );
            shouldContinue = false;
          }
        } catch (nextButtonError) {
          console.log(
            "🏁 Next button handling failed - quiz may be complete:",
            (nextButtonError as Error).message
          );
          shouldContinue = false;
        }

        // Check if we hit the maximum questions limit
        if (questionNumber > maxQuestionsPerQuiz) {
          console.log(
            `⚠️ Reached maximum questions limit (${maxQuestionsPerQuiz}) for quiz - may have encountered an infinite loop`
          );
        }
      } catch (questionError) {
        console.log(
          `❌ Error processing question ${questionNumber}:`,
          questionError
        );
        quizStats.questionsSkipped++;
        shouldContinue = false;
      }
    }

    // Quiz completion stats
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📊 QUIZ COMPLETE: ${quiz.quiz}`);
    console.log(`${"=".repeat(60)}`);
    console.log(`📈 Statistics:`);
    console.log(`   • Questions Attempted: ${quizStats.questionsAttempted}`);
    console.log(`   • Questions Answered: ${quizStats.questionsAnswered}`);
    console.log(`   • Questions Skipped: ${quizStats.questionsSkipped}`);
    console.log(`   • Database Answers: ${quizStats.databaseAnswers}`);
    console.log(`   • Random Answers: ${quizStats.randomAnswers}`);
    console.log(`   • Gemini AI Answers: ${quizStats.geminiAnswers}`);
    console.log(
      `   • Success Rate: ${
        quizStats.questionsAttempted > 0
          ? (
              (quizStats.questionsAnswered / quizStats.questionsAttempted) *
              100
            ).toFixed(1)
          : 0
      }%`
    );
    console.log(`${"=".repeat(60)}`);

    // Only try to claim reward if quiz was successfully completed
    if (quizStats.questionsAnswered > 0) {
      // Try to claim the reward
      await claimQuizReward(page);

      // Update global stats
      globalStats.totalQuestionsAttempted += quizStats.questionsAttempted;
      globalStats.totalQuestionsAnswered += quizStats.questionsAnswered;
      globalStats.totalQuestionsSkipped += quizStats.questionsSkipped;
      globalStats.totalRandomAnswers += quizStats.randomAnswers;
      globalStats.totalDatabaseAnswers += quizStats.databaseAnswers;
      globalStats.totalGeminiAnswers += quizStats.geminiAnswers;
      globalStats.successfulQuizzes++;

      return true; // Quiz was successful
    } else {
      console.log("❌ Quiz had no successful answers - skipping reward claim");
      return false; // Quiz failed
    }
  } catch (error) {
    console.error(`💥 Error in quiz ${quiz.quiz}:`, error);
    return false; // Quiz failed
  }
}

// Function to claim quiz reward with recaptcha handling
async function claimQuizReward(page: Page): Promise<void> {
  try {
    console.log(`\n🎁 Attempting to claim reward...`);

    // Add a timeout wrapper around the entire reward claiming process
    const rewardClaimTimeout = 180000; // 3 minutes timeout for the entire process

    const claimPromise = new Promise<void>(async (resolve) => {
      try {
        // Wait for the quiz completion page to load
        await new Promise((innerResolve) => setTimeout(innerResolve, 2000));

        // Look for the "CLAIM YOUR REWARD" button
        const claimButtonSelector =
          'a.kiaccountsbuttongreen[onclick*="openIframeSecure"]';

        try {
          await page.waitForSelector(claimButtonSelector, { timeout: 5000 });
          console.log("✅ Found 'CLAIM YOUR REWARD' button");

          // Click the claim button to open the popup
          await page.click(claimButtonSelector);
          console.log("🖱️  Clicked 'CLAIM YOUR REWARD' button");

          // Wait for the popup/iframe to load with retry logic
          console.log("⏳ Waiting for popup frame to load...");
          let popupFrame: import("puppeteer-core").Frame | null = null;
          let retryCount = 0;
          const maxRetries = 5;

          while (!popupFrame && retryCount < maxRetries) {
            retryCount++;
            console.log(
              `🔄 Attempt ${retryCount}/${maxRetries} to find popup frame...`
            );

            // Wait between retries (longer each time)
            await new Promise((innerResolve) =>
              setTimeout(innerResolve, 2000 * retryCount)
            );

            const frames = await page.frames();
            console.log(`📱 Found ${frames.length} frames on the page`);

            // Look for the iframe that contains the login/captcha form
            for (const frame of frames) {
              try {
                const frameUrl = frame.url();
                console.log(`🔍 Checking frame: ${frameUrl}`);

                if (
                  frameUrl.includes("/auth/popup/LoginWithCaptcha") ||
                  frameUrl.includes("captcha") ||
                  frameUrl.includes("/popup/") ||
                  (frameUrl.includes("wizard101.com") &&
                    frameUrl !== page.url())
                ) {
                  popupFrame = frame;
                  console.log("✅ Found popup frame with captcha");
                  break;
                }
              } catch {
                // Skip frames we can't access
                continue;
              }
            }
          }

          if (popupFrame) {
            console.log("🎯 Processing captcha popup...");

            // Apply stealth enhancements to the popup frame
            try {
              await popupFrame.evaluate(() => {
                // Remove automation indicators
                Object.defineProperty(navigator, "webdriver", {
                  get: () => undefined
                });

                // Add realistic browser properties
                Object.defineProperty(navigator, "plugins", {
                  get: () => [1, 2, 3, 4, 5] // Fake some plugins
                });

                // Override automation detection
                (window as unknown as Record<string, unknown>).chrome = {
                  runtime: {},
                  app: { isInstalled: false },
                  csi: () => {},
                  loadTimes: () => {}
                };

                // Add human-like properties
                Object.defineProperty(navigator, "hardwareConcurrency", {
                  get: () => 4
                });

                // Handle OneTrust cookie consent to prevent script blocking
                try {
                  (
                    window as unknown as Record<string, unknown>
                  ).OnetrustActiveGroups = "C0001,C0002,C0003,C0004,C0005";
                  (
                    window as unknown as Record<string, unknown>
                  ).OptanonWrapperCount = 1;

                  // Simulate cookie consent acceptance
                  if (
                    typeof (window as unknown as Record<string, unknown>)
                      .OneTrust !== "undefined"
                  ) {
                    const OneTrust = (
                      window as unknown as Record<string, unknown>
                    ).OneTrust as Record<string, unknown>;
                    if (typeof OneTrust.AllowAll === "function") {
                      (OneTrust.AllowAll as () => void)();
                    }
                  }

                  // Hide OneTrust banner if present in popup
                  const oneTrustContainer = document.getElementById(
                    "onetrust-consent-sdk"
                  );
                  if (oneTrustContainer) {
                    oneTrustContainer.style.display = "none";
                  }

                  console.log("✅ OneTrust cookie consent handled");
                } catch (cookieError) {
                  console.log("⚠️ OneTrust handling error:", cookieError);
                }

                // Set session variables to appear as legitimate user
                try {
                  (window as unknown as Record<string, unknown>).kiLoggedIn =
                    true;
                  (window as unknown as Record<string, unknown>).kiPayingUser =
                    true;
                  (window as unknown as Record<string, unknown>).kiIs18Plus =
                    true;
                  (
                    window as unknown as Record<string, unknown>
                  ).kiBillingActive = true;
                  (
                    window as unknown as Record<string, unknown>
                  ).isReCaptchaUsed = true;
                  console.log(
                    "✅ Session variables set for authenticated user"
                  );
                } catch (sessionError) {
                  console.log("⚠️ Session variable error:", sessionError);
                }

                // Disable common bot detection methods
                try {
                  // Override common bot detection properties
                  Object.defineProperty(window, "outerHeight", {
                    get: () => 1080
                  });
                  Object.defineProperty(window, "outerWidth", {
                    get: () => 1920
                  });

                  // Add realistic timing functions
                  const originalPerformance = window.performance;
                  (window as unknown as Record<string, unknown>).performance = {
                    ...originalPerformance,
                    now: () => Date.now() + Math.random() * 1000
                  };

                  // Ensure reCAPTCHA APIs are available
                  if (
                    typeof (window as unknown as Record<string, unknown>)
                      .grecaptcha === "undefined"
                  ) {
                    (window as unknown as Record<string, unknown>).grecaptcha =
                      {
                        ready: (callback: () => void) =>
                          setTimeout(callback, 100),
                        execute: () => Promise.resolve("mock-token"),
                        render: () => 1,
                        reset: () => {}
                      };
                  }

                  console.log("✅ Bot detection countermeasures applied");
                } catch (botError) {
                  console.log("⚠️ Bot detection error:", botError);
                }

                console.log(
                  "🛡️ Applied comprehensive stealth enhancements to popup frame"
                );
              });
            } catch (stealthError) {
              console.log(
                "⚠️ Could not apply stealth to popup frame:",
                stealthError
              );
            }

            // Add realistic delays and mouse movements
            console.log("⏳ Adding human-like delay before processing...");
            await new Promise((innerResolve) =>
              setTimeout(innerResolve, 1000 + Math.random() * 2000)
            );

            // Look for the claim button in the popup and click it immediately
            try {
              // Wait for the popup form to load
              await popupFrame.waitForSelector("form#theForm", {
                timeout: 10000
              });
              console.log("✅ Found popup form");

              // Wait a bit for page to settle
              await new Promise((innerResolve) =>
                setTimeout(innerResolve, 1000)
              );

              // Try different selectors for the claim button in the popup
              const popupClaimSelectors = [
                "a.buttonsubmit#submit", // Primary selector based on HTML
                'a[onclick="submitForm()"]', // Alternative by onclick
                "a.buttonsubmit", // Fallback by class
                "#submit", // Fallback by ID
                'input[type="submit"]#login', // Hidden submit input
                ".buttonsubmit"
              ];

              let popupClaimSuccess = false;
              for (const selector of popupClaimSelectors) {
                try {
                  const element = await popupFrame.$(selector);
                  if (element) {
                    console.log(
                      `🎯 Found popup claim button with selector: ${selector}`
                    );

                    // Check if element is visible and clickable
                    const isClickable = await element.evaluate((el) => {
                      const rect = el.getBoundingClientRect();
                      const style = window.getComputedStyle(el);
                      return (
                        rect.width > 0 &&
                        rect.height > 0 &&
                        style.display !== "none" &&
                        style.visibility !== "hidden"
                      );
                    });

                    if (isClickable) {
                      console.log("🖱️  Clicking claim button...");

                      // Add human-like mouse movement before clicking
                      try {
                        const box = await element.boundingBox();
                        if (box) {
                          const centerX = box.x + box.width / 2;
                          const centerY = box.y + box.height / 2;

                          // Get mouse from the frame's page
                          const framePage = popupFrame.page();

                          // Move mouse in a realistic way
                          await framePage.mouse.move(
                            centerX - 10,
                            centerY - 10,
                            {
                              steps: 5
                            }
                          );
                          await new Promise((innerResolve) =>
                            setTimeout(innerResolve, 100 + Math.random() * 200)
                          );
                          await framePage.mouse.move(centerX, centerY, {
                            steps: 3
                          });
                          await new Promise((innerResolve) =>
                            setTimeout(innerResolve, 50 + Math.random() * 100)
                          );

                          // Click with realistic timing
                          await framePage.mouse.click(centerX, centerY, {
                            delay: 50 + Math.random() * 50
                          });
                        } else {
                          // Fallback to element click
                          await element.click();
                        }
                      } catch (mouseError) {
                        console.log(
                          "⚠️ Mouse movement failed, using element click:",
                          mouseError
                        );
                        await element.click();
                      }

                      console.log(
                        "✅ Clicked popup claim button - recaptcha should appear"
                      );
                      popupClaimSuccess = true;
                      break;
                    } else {
                      console.log(
                        `⚠️ Element found but not clickable: ${selector}`
                      );
                    }
                  }
                } catch (selectorError) {
                  console.log(`❌ Selector ${selector} failed:`, selectorError);
                  continue;
                }
              }

              // If standard clicking didn't work, try JavaScript method
              if (!popupClaimSuccess) {
                console.log("🔄 Trying JavaScript submitForm() function...");
                try {
                  const jsSubmitSuccess = await popupFrame.evaluate(() => {
                    try {
                      // Call the submitForm function directly (as defined in the onclick)
                      if (
                        typeof (window as unknown as Record<string, unknown>)
                          .submitForm === "function"
                      ) {
                        (
                          (window as unknown as Record<string, unknown>)
                            .submitForm as () => void
                        )();
                        return true;
                      }

                      // Alternative: trigger click on hidden submit input
                      const hiddenSubmit = document.getElementById(
                        "login"
                      ) as HTMLInputElement;
                      if (hiddenSubmit) {
                        hiddenSubmit.click();
                        return true;
                      }

                      // Alternative: submit the form directly
                      const form = document.getElementById(
                        "theForm"
                      ) as HTMLFormElement;
                      if (form) {
                        form.submit();
                        return true;
                      }

                      return false;
                    } catch (error) {
                      console.log("JavaScript submit error:", error);
                      return false;
                    }
                  });

                  if (jsSubmitSuccess) {
                    console.log("✅ Successfully submitted via JavaScript");
                    popupClaimSuccess = true;
                  }
                } catch (jsError) {
                  console.log("❌ JavaScript submit failed:", jsError);
                }
              }

              if (popupClaimSuccess) {
                console.log(
                  "🎉 Claim button clicked! Recaptcha should appear..."
                );

                // Wait for recaptcha to appear
                await new Promise((innerResolve) =>
                  setTimeout(innerResolve, 3000)
                );

                // First, we need to submit the form in the popup to trigger the reCAPTCHA
                console.log(
                  "📋 Submitting form in popup to trigger reCAPTCHA..."
                );

                // Look for the popup frame first
                let popupSubmitted = false;
                const frames = await page.frames();
                console.log(`📱 Found ${frames.length} frames on the page`);

                for (const frame of frames) {
                  try {
                    const frameUrl = frame.url();
                    console.log(`🔍 Checking frame: ${frameUrl}`);

                    if (
                      frameUrl.includes("/auth/popup/LoginWithCaptcha") ||
                      frameUrl.includes("fpSessionAttribute=QUIZ_SESSION")
                    ) {
                      console.log("✅ Found login popup frame");

                      // Wait for the form to be ready
                      await frame.waitForSelector("form#theForm", {
                        timeout: 10000
                      });
                      console.log("✅ Found popup form");

                      // Try to click the submit button in the popup
                      const submitSelectors = [
                        "a.buttonsubmit#submit",
                        'a[onclick="submitForm()"]',
                        "a.buttonsubmit",
                        "#submit",
                        'input[type="submit"]#login'
                      ];

                      for (const selector of submitSelectors) {
                        try {
                          const element = await frame.$(selector);
                          if (element) {
                            console.log(
                              `🎯 Found submit button with selector: ${selector}`
                            );

                            // Check if element is clickable
                            const isClickable = await element.evaluate((el) => {
                              const rect = el.getBoundingClientRect();
                              const style = window.getComputedStyle(el);
                              return (
                                rect.width > 0 &&
                                rect.height > 0 &&
                                style.display !== "none" &&
                                style.visibility !== "hidden"
                              );
                            });

                            if (isClickable) {
                              console.log("🖱️  Clicking submit button...");
                              await element.click();
                              console.log(
                                "✅ Submit button clicked - reCAPTCHA should now load"
                              );
                              popupSubmitted = true;
                              break;
                            }
                          }
                        } catch (selectorError) {
                          console.log(
                            `❌ Selector ${selector} failed:`,
                            selectorError
                          );
                          continue;
                        }
                      }

                      // Try JavaScript method if button clicking failed
                      if (!popupSubmitted) {
                        console.log(
                          "🔄 Trying JavaScript submitForm() function..."
                        );
                        try {
                          const jsSubmitSuccess = await frame.evaluate(() => {
                            try {
                              if (
                                typeof (
                                  window as unknown as Record<string, unknown>
                                ).submitForm === "function"
                              ) {
                                (
                                  (window as unknown as Record<string, unknown>)
                                    .submitForm as () => void
                                )();
                                return true;
                              }

                              const hiddenSubmit = document.getElementById(
                                "login"
                              ) as HTMLInputElement;
                              if (hiddenSubmit) {
                                hiddenSubmit.click();
                                return true;
                              }

                              const form = document.getElementById(
                                "theForm"
                              ) as HTMLFormElement;
                              if (form) {
                                form.submit();
                                return true;
                              }

                              return false;
                            } catch (error) {
                              console.log("JavaScript submit error:", error);
                              return false;
                            }
                          });

                          if (jsSubmitSuccess) {
                            console.log(
                              "✅ Successfully submitted via JavaScript"
                            );
                            popupSubmitted = true;
                          }
                        } catch (jsError) {
                          console.log("❌ JavaScript submit failed:", jsError);
                        }
                      }

                      break; // Found the login frame, no need to check others
                    }
                  } catch {
                    continue; // Skip frames we can't access
                  }
                }

                if (!popupSubmitted) {
                  console.log("❌ Could not submit popup form");
                  resolve();
                  return;
                }

                // Add comprehensive debugging after form submission
                console.log("🔍 Adding detailed post-submission debugging...");

                // Wait a moment for the form submission to process
                await new Promise((innerResolve) =>
                  setTimeout(innerResolve, 2000)
                );

                // Check the popup frame state after submission
                try {
                  const postSubmissionState = await popupFrame.evaluate(() => {
                    return {
                      url: window.location.href,
                      title: document.title,
                      formExists: !!document.getElementById("theForm"),
                      reCaptchaElementExists:
                        !!document.querySelector(".g-recaptcha"),
                      reCaptchaVisible: (() => {
                        const el = document.querySelector(".g-recaptcha");
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        return (
                          style.display !== "none" &&
                          style.visibility !== "hidden"
                        );
                      })(),
                      captchaTokenFieldExists:
                        !!document.getElementById("captchaToken"),
                      captchaTokenValue:
                        (
                          document.getElementById(
                            "captchaToken"
                          ) as HTMLInputElement
                        )?.value || "empty",
                      scriptsLoaded: {
                        grecaptcha:
                          typeof (window as unknown as Record<string, unknown>)
                            .grecaptcha !== "undefined",
                        submitForm:
                          typeof (window as unknown as Record<string, unknown>)
                            .submitForm !== "undefined",
                        reCaptchaCallback:
                          typeof (window as unknown as Record<string, unknown>)
                            .reCaptchaCallback !== "undefined"
                      },
                      bodyHTML:
                        document.body.innerHTML.substring(0, 500) + "..."
                    };
                  });

                  console.log(
                    "📊 Post-submission popup state:",
                    JSON.stringify(postSubmissionState, null, 2)
                  );

                  // Check if reCAPTCHA script loaded properly
                  if (!postSubmissionState.scriptsLoaded.grecaptcha) {
                    console.log(
                      "⚠️ grecaptcha not loaded - may need to wait for script or trigger manually"
                    );
                  }

                  // Check if the invisible reCAPTCHA element exists but isn't activated
                  if (
                    postSubmissionState.reCaptchaElementExists &&
                    !postSubmissionState.reCaptchaVisible
                  ) {
                    console.log(
                      "🎯 reCAPTCHA element exists but may not be activated"
                    );

                    // Try to manually trigger the reCAPTCHA
                    console.log(
                      "🔄 Attempting to manually trigger invisible reCAPTCHA..."
                    );
                    const manualTriggerResult = await popupFrame.evaluate(
                      () => {
                        try {
                          // Try different ways to trigger the invisible reCAPTCHA
                          if (
                            typeof (
                              window as unknown as Record<string, unknown>
                            ).grecaptcha !== "undefined"
                          ) {
                            const grecaptcha = (
                              window as unknown as Record<string, unknown>
                            ).grecaptcha as Record<string, unknown>;

                            // Method 1: Direct execute call
                            if (typeof grecaptcha.execute === "function") {
                              console.log(
                                "🎯 Calling grecaptcha.execute() directly..."
                              );
                              (grecaptcha.execute as () => void)();
                              return "executed_directly";
                            }

                            // Method 2: Reset and execute
                            if (
                              typeof grecaptcha.reset === "function" &&
                              typeof grecaptcha.execute === "function"
                            ) {
                              console.log(
                                "🎯 Resetting and executing grecaptcha..."
                              );
                              (grecaptcha.reset as () => void)();
                              setTimeout(
                                () => (grecaptcha.execute as () => void)(),
                                100
                              );
                              return "reset_and_executed";
                            }

                            // Method 3: Render and execute
                            if (typeof grecaptcha.render === "function") {
                              console.log("🎯 Rendering grecaptcha...");
                              const recaptchaEl =
                                document.querySelector(".g-recaptcha");
                              if (recaptchaEl) {
                                (
                                  grecaptcha.render as (
                                    el: Element,
                                    config: Record<string, unknown>
                                  ) => void
                                )(recaptchaEl, {
                                  sitekey:
                                    "6LfUFE0UAAAAAGoVniwSC9-MtgxlzzAb5dnr9WWY",
                                  size: "invisible",
                                  callback: "reCaptchaCallback"
                                });
                                return "rendered";
                              }
                            }
                          }

                          // Method 4: Try calling submitForm again (it should trigger grecaptcha.execute)
                          if (
                            typeof (
                              window as unknown as Record<string, unknown>
                            ).submitForm === "function"
                          ) {
                            console.log("🎯 Calling submitForm again...");
                            (
                              (window as unknown as Record<string, unknown>)
                                .submitForm as () => void
                            )();
                            return "submitForm_called_again";
                          }

                          return "no_methods_available";
                        } catch (error) {
                          console.log(
                            "❌ Manual trigger error:",
                            (error as Error).message
                          );
                          return "error: " + (error as Error).message;
                        }
                      }
                    );

                    console.log(
                      "🔄 Manual trigger result:",
                      manualTriggerResult
                    );

                    // Wait a bit more after manual trigger
                    await new Promise((innerResolve) =>
                      setTimeout(innerResolve, 3000)
                    );
                  }
                } catch (debugError) {
                  console.log(
                    "❌ Post-submission debugging error:",
                    debugError
                  );
                }

                // FALLBACK: Use known site key directly if iframe doesn't load
                console.log("🔄 Attempting fallback with known site key...");
                try {
                  const knownSiteKey =
                    "6LfUFE0UAAAAAGoVniwSC9-MtgxlzzAb5dnr9WWY";
                  const popupUrl = popupFrame.url();

                  console.log(`🔑 Using known site key: ${knownSiteKey}`);
                  console.log(`🌐 Using popup URL: ${popupUrl}`);

                  const solver = new TwoCaptcha.Solver(
                    process.env.TWO_CAPTCHA_API_KEY!
                  );

                  console.log(
                    "⏳ Submitting to TwoCaptcha with known parameters..."
                  );
                  const result = await solver.recaptcha({
                    pageurl: popupUrl,
                    googlekey: knownSiteKey,
                    invisible: true
                  });

                  console.log("✅ TwoCaptcha solved with fallback method!");
                  console.log(`📝 Token: ${result.data.substring(0, 50)}...`);

                  // Inject token and submit
                  const fallbackSuccess = await popupFrame.evaluate((token) => {
                    try {
                      console.log(
                        "🎯 Fallback: Injecting token and submitting..."
                      );

                      // Set the captchaToken field
                      const captchaTokenField = document.getElementById(
                        "captchaToken"
                      ) as HTMLInputElement;
                      if (captchaTokenField) {
                        captchaTokenField.value = token;
                        console.log(
                          "✅ Fallback: Token set in captchaToken field"
                        );
                      }

                      // Set g-recaptcha-response if it exists
                      const responseField = document.getElementById(
                        "g-recaptcha-response"
                      ) as HTMLTextAreaElement;
                      if (responseField) {
                        responseField.value = token;
                        responseField.innerHTML = token;
                        console.log(
                          "✅ Fallback: Token set in g-recaptcha-response field"
                        );
                      }

                      // Try to call the callback function directly
                      if (
                        typeof (window as unknown as Record<string, unknown>)
                          .reCaptchaCallback === "function"
                      ) {
                        console.log(
                          "📞 Fallback: Calling reCaptchaCallback..."
                        );
                        (
                          (window as unknown as Record<string, unknown>)
                            .reCaptchaCallback as (token: string) => void
                        )(token);
                        return true;
                      }

                      // Fallback: click the login button
                      const loginButton = document.getElementById(
                        "login"
                      ) as HTMLInputElement;
                      if (loginButton) {
                        console.log("🖱️ Fallback: Clicking login button...");
                        loginButton.click();
                        return true;
                      }

                      console.log("❌ Fallback: No submission method worked");
                      return false;
                    } catch (error) {
                      console.log(
                        "❌ Fallback error:",
                        (error as Error).message
                      );
                      return false;
                    }
                  }, result.data);

                  if (fallbackSuccess) {
                    console.log("🎉 Fallback submission successful!");

                    // Wait and check for success
                    await new Promise((innerResolve) =>
                      setTimeout(innerResolve, 5000)
                    );

                    const finalStatus = await page.evaluate(() => {
                      return {
                        hasSuccess: !!document.querySelector(
                          ".success, .reward-claimed"
                        ),
                        hasError: !!document.querySelector(".error, .alert"),
                        currentUrl: window.location.href
                      };
                    });

                    console.log("📊 Final status:", finalStatus);
                    resolve();
                    return;
                  }
                } catch (fallbackError) {
                  console.log("❌ Fallback method failed:", fallbackError);
                }

                // ENHANCED: Nested iframe detection for reCAPTCHA
                console.log(
                  "🔍 Attempting nested iframe detection for reCAPTCHA..."
                );
                try {
                  // Wait a moment for potential iframe loading after form submission
                  await new Promise((innerResolve) =>
                    setTimeout(innerResolve, 3000)
                  );

                  // Search for reCAPTCHA in nested iframes with comprehensive inspection
                  const nestedIframeResult = await page.evaluate(() => {
                    console.log(
                      "🔍 Starting comprehensive nested iframe search for reCAPTCHA..."
                    );

                    interface IframeSearchResult {
                      found: boolean;
                      siteKey?: string;
                      path?: string[];
                      details?: string;
                    }

                    // Function to recursively search through all iframe levels
                    const searchNestedIframes = (
                      doc: Document,
                      path: string[] = [],
                      maxDepth: number = 5
                    ): IframeSearchResult => {
                      const currentPath = path.join(" → ");
                      console.log(
                        `🔍 Level ${path.length}: Searching in ${
                          currentPath || "main document"
                        }`
                      );

                      // First, check the current document for reCAPTCHA elements
                      const recaptchaElements = [
                        doc.querySelector("[data-sitekey]"),
                        doc.querySelector(".g-recaptcha"),
                        doc.querySelector("#g-recaptcha-response")
                      ].filter(Boolean);

                      if (recaptchaElements.length > 0) {
                        console.log(
                          `🎯 Found ${recaptchaElements.length} reCAPTCHA elements at level ${path.length}`
                        );

                        for (const element of recaptchaElements) {
                          const siteKey = element?.getAttribute("data-sitekey");
                          if (siteKey) {
                            console.log(
                              `✅ Found data-sitekey at ${currentPath}: ${siteKey}`
                            );
                            return {
                              found: true,
                              siteKey,
                              path,
                              details: `data-sitekey attribute`
                            };
                          }
                        }
                      }

                      // Search through all iframes in the current document
                      const iframes = Array.from(
                        doc.querySelectorAll("iframe")
                      );
                      console.log(
                        `📱 Found ${iframes.length} iframes at level ${path.length}`
                      );

                      for (let i = 0; i < iframes.length; i++) {
                        const iframe = iframes[i];
                        const src = iframe.src || "no src";
                        const title = iframe.title || "no title";
                        const name = iframe.name || "no name";
                        const id = iframe.id || "no id";

                        const iframePath = [
                          ...path,
                          `iframe[${i}](${id || name || "unnamed"})`
                        ];
                        console.log(
                          `📱 Level ${path.length} iframe ${
                            i + 1
                          }: src="${src}", title="${title}", name="${name}", id="${id}"`
                        );

                        // Check if this iframe looks like a reCAPTCHA iframe by its properties
                        if (
                          src &&
                          (src.includes("recaptcha/api2/bframe") ||
                            src.includes("recaptcha/api2/anchor") ||
                            src.includes("google.com/recaptcha") ||
                            src.includes("gstatic.com/recaptcha") ||
                            title.toLowerCase().includes("recaptcha") ||
                            name.toLowerCase().includes("recaptcha"))
                        ) {
                          console.log(
                            `🎯 Found reCAPTCHA iframe by properties: ${src}`
                          );

                          try {
                            const url = new URL(src);
                            const siteKey = url.searchParams.get("k");
                            if (siteKey) {
                              console.log(
                                `✅ Extracted site key from iframe URL: ${siteKey}`
                              );
                              return {
                                found: true,
                                siteKey,
                                path: iframePath,
                                details: `iframe src parameter 'k'`
                              };
                            }
                          } catch (urlError) {
                            console.log(
                              `❌ Error parsing iframe URL: ${urlError}`
                            );
                          }
                        }

                        // Try to access iframe content for deeper search (if same-origin and not max depth)
                        if (path.length < maxDepth) {
                          try {
                            const iframeDoc =
                              iframe.contentDocument ||
                              iframe.contentWindow?.document;
                            if (iframeDoc) {
                              console.log(
                                `🔄 Recursing into iframe ${i + 1} at level ${
                                  path.length + 1
                                }...`
                              );
                              const nestedResult = searchNestedIframes(
                                iframeDoc,
                                iframePath,
                                maxDepth
                              );
                              if (nestedResult.found) {
                                return nestedResult;
                              }
                            } else {
                              console.log(
                                `❌ Cannot access iframe ${
                                  i + 1
                                } content (likely cross-origin)`
                              );
                            }
                          } catch (accessError) {
                            console.log(
                              `❌ Cross-origin access blocked for iframe ${
                                i + 1
                              }:`,
                              accessError
                            );
                          }
                        } else {
                          console.log(
                            `⚠️ Max depth (${maxDepth}) reached, skipping iframe ${
                              i + 1
                            }`
                          );
                        }
                      }

                      return { found: false };
                    };

                    // Start the search from the main document
                    return searchNestedIframes(document);
                  });

                  if (nestedIframeResult.found && nestedIframeResult.siteKey) {
                    console.log(`🎉 Nested iframe search successful!`);
                    console.log(`🔑 Site key: ${nestedIframeResult.siteKey}`);
                    console.log(
                      `📍 Found at: ${
                        nestedIframeResult.path?.join(" → ") || "unknown"
                      }`
                    );
                    console.log(`📝 Method: ${nestedIframeResult.details}`);

                    // Use the found site key with TwoCaptcha
                    const solver = new TwoCaptcha.Solver(
                      process.env.TWO_CAPTCHA_API_KEY!
                    );
                    const popupUrl = popupFrame.url();

                    console.log(
                      "⏳ Submitting nested iframe reCAPTCHA to TwoCaptcha..."
                    );
                    const result = await solver.recaptcha({
                      pageurl: popupUrl,
                      googlekey: nestedIframeResult.siteKey,
                      invisible: true
                    });

                    console.log(
                      "✅ TwoCaptcha solved nested iframe reCAPTCHA!"
                    );
                    console.log(`📝 Token: ${result.data.substring(0, 50)}...`);

                    // Inject token and submit
                    const nestedSuccess = await popupFrame.evaluate((token) => {
                      try {
                        console.log(
                          "🎯 Nested: Injecting token and submitting..."
                        );

                        // Set the captchaToken field
                        const captchaTokenField = document.getElementById(
                          "captchaToken"
                        ) as HTMLInputElement;
                        if (captchaTokenField) {
                          captchaTokenField.value = token;
                          console.log(
                            "✅ Nested: Token set in captchaToken field"
                          );
                        }

                        // Set g-recaptcha-response if it exists
                        const responseField = document.getElementById(
                          "g-recaptcha-response"
                        ) as HTMLTextAreaElement;
                        if (responseField) {
                          responseField.value = token;
                          responseField.innerHTML = token;
                          console.log(
                            "✅ Nested: Token set in g-recaptcha-response field"
                          );
                        }

                        // Try to call the callback function directly
                        if (
                          typeof (window as unknown as Record<string, unknown>)
                            .reCaptchaCallback === "function"
                        ) {
                          console.log(
                            "📞 Nested: Calling reCaptchaCallback..."
                          );
                          (
                            (window as unknown as Record<string, unknown>)
                              .reCaptchaCallback as (token: string) => void
                          )(token);
                          return true;
                        }

                        // Fallback: click the login button
                        const loginButton = document.getElementById(
                          "login"
                        ) as HTMLInputElement;
                        if (loginButton) {
                          console.log("🖱️ Nested: Clicking login button...");
                          loginButton.click();
                          return true;
                        }

                        console.log("❌ Nested: No submission method worked");
                        return false;
                      } catch (error) {
                        console.log(
                          "❌ Nested error:",
                          (error as Error).message
                        );
                        return false;
                      }
                    }, result.data);

                    if (nestedSuccess) {
                      console.log(
                        "🎉 Nested iframe reCAPTCHA submission successful!"
                      );

                      // Wait and check for success
                      await new Promise((innerResolve) =>
                        setTimeout(innerResolve, 5000)
                      );

                      const finalStatus = await page.evaluate(() => {
                        return {
                          hasSuccess: !!document.querySelector(
                            ".success, .reward-claimed"
                          ),
                          hasError: !!document.querySelector(".error, .alert"),
                          currentUrl: window.location.href
                        };
                      });

                      console.log(
                        "📊 Final nested iframe status:",
                        finalStatus
                      );
                      resolve();
                      return;
                    }
                  } else {
                    console.log(
                      "❌ Nested iframe search did not find reCAPTCHA"
                    );
                    console.log(
                      "🔍 This may indicate the reCAPTCHA is not yet loaded or is in a cross-origin iframe"
                    );
                  }
                } catch (nestedError) {
                  console.log(
                    "❌ Nested iframe detection failed:",
                    nestedError
                  );
                }
              } else {
                console.log("❌ Could not find or click popup claim button");
              }
            } catch (e) {
              console.log("❌ Could not find claim button in popup:", e);
            }
          } else {
            console.log(
              "❌ Could not find popup frame with captcha after retries"
            );
          }
        } catch (e) {
          console.log(
            "❌ Could not find or click 'CLAIM YOUR REWARD' button:",
            e
          );
        }
      } catch (error) {
        console.log(`❌ Error claiming reward:`, error);
      }

      resolve();
    });

    // Add timeout wrapper
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.log("⏰ Reward claiming timeout - continuing to next quiz");
        resolve();
      }, rewardClaimTimeout);
    });

    // Wait for either completion or timeout
    await Promise.race([claimPromise, timeoutPromise]);

    console.log("🔄 Reward claiming process completed, moving to next quiz");
  } catch (error) {
    console.log(`❌ Error in reward claiming wrapper:`, error);
  }
}

async function main() {
  // Add error handlers for CI debugging
  if (isCI) {
    process.on("unhandledRejection", (reason, promise) => {
      console.log("🚨 Unhandled Rejection at:", promise, "reason:", reason);
    });

    process.on("uncaughtException", (error) => {
      console.log("🚨 Uncaught Exception:", error);
    });
  }

  // Check for required environment variables
  const username = process.env.WIZARD101_USERNAME;
  const password = process.env.WIZARD101_PASSWORD;
  const twoCaptchaApiKey = process.env.TWO_CAPTCHA_API_KEY;

  if (!username || !password) {
    console.error(
      "Please set WIZARD101_USERNAME and WIZARD101_PASSWORD environment variables in .env.local"
    );
    process.exit(1);
  }

  if (!twoCaptchaApiKey) {
    console.error(
      "❌ TWO_CAPTCHA_API_KEY not found in .env.local - reCAPTCHA solving will not work"
    );
    console.error(
      "Get a TwoCaptcha API key from: https://2captcha.com/enterpage"
    );
    console.error(
      "Add TWO_CAPTCHA_API_KEY=your_api_key to your .env.local file"
    );
    process.exit(1);
  } else {
    console.log(
      "✅ TwoCaptcha API key found - automatic reCAPTCHA solving enabled"
    );
  }

  console.log(
    "🤖 TwoCaptcha service will be used for automatic reCAPTCHA solving"
  );

  // Fetch quiz answers from local file at the start
  console.log("\n=== Initializing Quiz Data ===");
  try {
    const quizAnswers = await fetchQuizAnswers();
    console.log(`📚 Loaded ${quizAnswers.length} quizzes from local file`);
  } catch (error) {
    console.error("❌ Failed to load quiz answers from local file:", error);
    console.error(
      "Please check that the quiz-answers.json file exists and is valid."
    );
    process.exit(1);
  }

  // Create a persistent user data directory in the project folder
  const projectDir = process.cwd();
  const userDataDir = path.join(projectDir, ".chrome-user-data");

  // Ensure the user data directory exists (only for local environments)
  if (!isCI && !fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
    console.log(`📁 Created Chrome user data directory: ${userDataDir}`);
  }

  // Check if debug mode is enabled
  const debugMode =
    process.env.DEBUG_MODE === "true" || process.env.NODE_ENV === "development";

  // isCI is already defined at the top of the file for stealth plugin configuration

  // Force visible mode for now since headless mode has login issues, but respect CI environment
  const forceVisible = process.env.FORCE_VISIBLE !== "false";
  const shouldRunVisible = (debugMode || forceVisible) && !isCI;

  console.log(`🔧 Debug mode: ${debugMode ? "ENABLED" : "DISABLED"}`);
  console.log(`🔧 Force visible: ${forceVisible ? "ENABLED" : "DISABLED"}`);
  console.log(`🔧 CI environment: ${isCI ? "DETECTED" : "NOT DETECTED"}`);
  console.log(
    `🖥️ Browser will run in ${shouldRunVisible ? "VISIBLE" : "HEADLESS"} mode`
  );

  // Detect Chrome executable path for puppeteer-core
  const getChromePath = () => {
    // Check environment variable first (for GitHub Actions)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    // Platform-specific Chrome paths
    const platform = process.platform;

    if (platform === "darwin") {
      // macOS paths
      const macPaths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium"
      ];

      for (const chromePath of macPaths) {
        if (fs.existsSync(chromePath)) {
          return chromePath;
        }
      }
    } else if (platform === "linux") {
      // Linux paths
      const linuxPaths = [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium"
      ];

      for (const chromePath of linuxPaths) {
        if (fs.existsSync(chromePath)) {
          return chromePath;
        }
      }
    } else if (platform === "win32") {
      // Windows paths
      const windowsPaths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Users\\%USERNAME%\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"
      ];

      for (const chromePath of windowsPaths) {
        if (fs.existsSync(chromePath)) {
          return chromePath;
        }
      }
    }

    throw new Error(
      `Chrome not found on ${platform}. Please install Google Chrome or set PUPPETEER_EXECUTABLE_PATH environment variable.`
    );
  };

  const executablePath = getChromePath();
  console.log(`🔧 Using Chrome at: ${executablePath}`);

  // Prepare browser arguments with CI-specific optimizations
  const baseArgs = [
    "--no-sandbox", // Required for most environments
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled", // Additional stealth
    "--disable-extensions",
    "--disable-default-apps",
    "--no-first-run",
    "--no-default-browser-check"
  ];

  // Add CI-specific arguments - minimal and stable
  const ciArgs = isCI
    ? [
        "--disable-gpu", // Required for headless mode in CI
        "--disable-gpu-sandbox",
        "--disable-software-rasterizer",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=TranslateUI,VizDisplayCompositor",
        "--memory-pressure-off",
        "--max_old_space_size=4096"
      ]
    : [
        "--start-maximized",
        "--enable-experimental-web-platform-features", // Enable better cursor support
        "--force-renderer-accessibility" // Ensure accessibility features work
      ];

  // Add debug-specific arguments
  const debugArgs =
    debugMode && !isCI
      ? ["--disable-extensions-except", "--disable-plugins-discovery"]
      : [];

  const allArgs = [...baseArgs, ...ciArgs, ...debugArgs];

  console.log(
    `🔧 Browser arguments: ${allArgs.length} args configured for ${
      isCI ? "CI" : "local"
    } environment`
  );

  // Launch browser with stealth-optimized settings
  console.log("🚀 Launching browser...");

  let browser;
  try {
    const launchOptions = {
      executablePath, // Required for puppeteer-core
      headless: isCI ? "new" : !shouldRunVisible, // Use new headless mode for CI, respect visible setting for local
      defaultViewport: isCI ? { width: 1366, height: 768 } : null, // Set default viewport for CI
      args: allArgs,
      // Add additional stability options for CI
      ...(isCI && {
        timeout: 60000, // Increase timeout for CI
        protocolTimeout: 240000, // Increase protocol timeout
        ignoreDefaultArgs: ["--enable-automation"], // Remove automation flags
        ignoreHTTPSErrors: true // Ignore HTTPS errors in CI
      }),
      // Only use userDataDir for local environments
      ...(!isCI && { userDataDir: userDataDir })
    };

    console.log(
      `🔧 Launch options configured for ${isCI ? "CI" : "local"} environment`
    );
    if (isCI) {
      console.log(
        `🔧 CI mode: headless="${
          launchOptions.headless
        }", viewport=${JSON.stringify(launchOptions.defaultViewport)}`
      );
      console.log(
        `🔧 CI args sample: ${allArgs.slice(0, 5).join(", ")}... (${
          allArgs.length
        } total)`
      );
    }

    browser = await puppeteer.launch(launchOptions);

    console.log("✅ Browser launched successfully");

    // Add browser event listeners for debugging in CI
    if (isCI) {
      browser.on("disconnected", () => {
        console.log("🔌 Browser disconnected event");
      });

      browser.on("targetcreated", (target) => {
        console.log(`🎯 Target created: ${target.type()} - ${target.url()}`);
      });

      browser.on("targetdestroyed", (target) => {
        console.log(`💥 Target destroyed: ${target.type()}`);
      });

      console.log(`🔧 Browser version: ${await browser.version()}`);
      console.log(`🔧 Browser user agent: ${await browser.userAgent()}`);
    }
  } catch (launchError) {
    console.error("❌ Browser launch failed:", launchError);
    throw new Error(`Browser launch failed: ${launchError.message}`);
  }

  try {
    console.log("📄 Creating new page...");

    // Add retry logic for page creation in CI
    let page;
    let pageCreateRetries = 0;
    const maxPageCreateRetries = isCI ? 3 : 1;

    while (pageCreateRetries < maxPageCreateRetries) {
      try {
        page = await browser.newPage();

        // Immediately check if page is valid
        if (page.isClosed()) {
          throw new Error("Page was closed immediately after creation");
        }

        console.log("✅ New page created successfully");
        break;
      } catch (pageCreateError) {
        pageCreateRetries++;
        console.log(
          `❌ Page creation attempt ${pageCreateRetries}/${maxPageCreateRetries} failed:`,
          pageCreateError.message
        );

        if (pageCreateRetries >= maxPageCreateRetries) {
          throw new Error(
            `Page creation failed after ${maxPageCreateRetries} attempts: ${pageCreateError.message}`
          );
        }

        // Wait before retry
        console.log("⏳ Waiting before page creation retry...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Wait a moment for the page to stabilize in CI
    if (isCI) {
      console.log("⏳ Waiting for page to stabilize in CI environment...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Double-check page is still valid after stabilization
      if (page.isClosed()) {
        throw new Error("Page became closed during stabilization");
      }
    }

    // Enhanced stealth setup (simplified for CI)
    console.log(
      `🛡️ Setting up ${isCI ? "simplified" : "enhanced"} stealth mode...`
    );

    // Set realistic viewport (skip for CI since we set defaultViewport)
    if (!isCI) {
      try {
        console.log("🖼️ Setting viewport...");
        await page.setViewport({ width: 1366, height: 768 });
        console.log("✅ Viewport set successfully");
      } catch (viewportError) {
        console.log(
          "⚠️ Viewport setting failed, continuing:",
          viewportError.message
        );
      }
    } else {
      console.log(
        "🔧 Skipping manual viewport setting in CI (using defaultViewport)"
      );
    }

    // Fix cursor visibility and interaction issues (only for local environments)
    if (!isCI) {
      try {
        await page.evaluateOnNewDocument(() => {
          // Ensure cursor is always visible and properly styled
          const style = document.createElement("style");
          style.textContent = `
            * {
              cursor: auto !important;
            }
            button, input[type="submit"], input[type="button"], a {
              cursor: pointer !important;
            }
            body {
              cursor: auto !important;
            }
          `;
          document.head.appendChild(style);

          // Override any scripts that might hide the cursor
          Object.defineProperty(document.body.style, "cursor", {
            get: function () {
              return "auto";
            },
            set: function () {
              /* ignore attempts to hide cursor */
            }
          });

          // Ensure mouse events work properly
          window.addEventListener("load", () => {
            document.body.style.cursor = "auto";
          });
        });
        console.log("✅ Enhanced cursor setup applied for local environment");
      } catch (error) {
        console.log(
          "⚠️ Enhanced cursor setup failed, continuing without it:",
          error
        );
      }
    } else {
      console.log("🔧 Skipping cursor enhancement in CI environment");
    }

    // Test stealth effectiveness (only for local environments)
    if (!isCI) {
      await testStealthMode(page);
    } else {
      console.log("🔧 Skipping stealth test in CI environment");
    }

    // Go to main page with enhanced error handling for CI
    console.log("🌐 Navigating to Wizard101...");

    try {
      // Check if page is still valid before navigation
      if (page.isClosed()) {
        throw new Error("Page was closed before navigation");
      }

      // Add extra stabilization for CI environments
      if (isCI) {
        console.log("⏳ Additional CI stabilization before navigation...");
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Verify page is still valid after wait
        if (page.isClosed()) {
          throw new Error("Page became closed during stabilization");
        }
      }

      await page.goto("https://www.wizard101.com/game", {
        waitUntil: isCI ? "domcontentloaded" : "networkidle0", // Use faster wait condition for CI
        timeout: isCI ? 60000 : 30000 // Longer timeout for CI
      });

      console.log("✅ Navigation completed successfully");
    } catch (navigationError) {
      console.error("❌ Navigation failed:", navigationError.message);

      // Try to recover with a simpler navigation approach
      if (isCI) {
        console.log(
          "🔄 Attempting recovery navigation with simpler settings..."
        );
        try {
          // Create a new page if the current one is problematic
          const newPage = await browser.newPage();
          console.log("✅ Created recovery page");

          await newPage.goto("https://www.wizard101.com/game", {
            waitUntil: "domcontentloaded",
            timeout: 60000
          });

          // Replace the problematic page with the working one
          await page.close();
          // Note: We'll need to update the page reference - for now, throw to exit gracefully
          throw new Error("Page recovery needed - please retry the workflow");
        } catch (recoveryError) {
          console.error(
            "❌ Recovery navigation also failed:",
            recoveryError.message
          );
          throw new Error(
            `Navigation failed completely: ${navigationError.message} | Recovery failed: ${recoveryError.message}`
          );
        }
      } else {
        throw navigationError;
      }
    }

    // Ensure cursor is visible after page load
    await page.evaluate(() => {
      document.body.style.cursor = "auto";
    });

    // Add random human-like delay
    await new Promise((resolve) =>
      setTimeout(resolve, 1000 + Math.random() * 2000)
    );

    // Check for and handle potential CAPTCHAs or security challenges
    console.log("🔍 Checking for security challenges...");
    const securityCheck = await page.evaluate(() => {
      const captcha = document.querySelector(
        '[src*="captcha"], .captcha, #captcha, .recaptcha, .hcaptcha'
      );
      const cloudflare = document.querySelector(
        ".cf-browser-verification, .cf-checking, #cf-wrapper"
      );
      const securityMessage = document.querySelector(
        ".security-check, .bot-detection, .verification"
      );

      return {
        hasCaptcha: !!captcha,
        hasCloudflare: !!cloudflare,
        hasSecurityMessage: !!securityMessage,
        title: document.title,
        url: window.location.href
      };
    });

    console.log("🔍 Security check result:", securityCheck);

    if (securityCheck.hasCaptcha || securityCheck.hasCloudflare) {
      console.log(
        "⚠️ Security challenge detected. Please solve manually and press Enter to continue..."
      );

      // Wait for user to solve CAPTCHA manually
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      await new Promise<void>((resolve) => {
        rl.question(
          "Press Enter after solving the security challenge...",
          () => {
            rl.close();
            resolve();
          }
        );
      });
    }

    // Wait for login form and handle login
    console.log("📝 Waiting for login form...");
    try {
      await page.waitForSelector("#loginUserName", { timeout: 5000 });
    } catch {
      console.log(
        "❌ Login form not found. Current page title:",
        await page.title()
      );
      console.log("📍 Current URL:", page.url());
      throw new Error(
        "Login form not accessible. The site may have changed or there's a security block."
      );
    }

    // Fill login credentials
    console.log("📝 Filling login credentials...");

    // Type username
    await page.focus("#loginUserName");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.type("#loginUserName", username, { delay: 100 });

    // Add pause between fields
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Type password
    await page.focus("#loginPassword");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.type("#loginPassword", password, { delay: 100 });

    // Wait for form to be ready
    console.log("⏳ Waiting for form to be ready...");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Enhanced login button clicking
    console.log("🔐 Attempting login...");

    // Try Enter key on password field first (most reliable)
    try {
      await page.focus("#loginPassword");
      await page.keyboard.press("Enter");
      console.log("✅ Login attempted via Enter key");
    } catch (enterError) {
      console.log("❌ Enter key failed, trying button click:", enterError);

      // Fallback: click the submit button
      try {
        await page.click('#wizardLoginButton input[type="submit"]');
        console.log("✅ Login attempted via button click");
      } catch (clickError) {
        console.log("❌ Button click failed:", clickError);
        throw new Error("All login methods failed");
      }
    }

    // Wait for login to process with better detection
    console.log("⏳ Waiting for login to process...");
    try {
      // Wait for either navigation or URL change
      await Promise.race([
        page.waitForNavigation({ waitUntil: "networkidle0", timeout: 8000 }),
        page.waitForFunction(
          () => window.location.href !== "https://www.wizard101.com/game",
          { timeout: 8000 }
        )
      ]);
      console.log("✅ Navigation or URL change detected");
    } catch {
      console.log("⚠️ Navigation timeout, checking current state...");
    }

    const currentUrl = page.url();
    console.log("📍 Current URL:", currentUrl);

    // Enhanced login verification
    console.log("🔍 Verifying login success...");

    // Wait a bit for potential redirects after login
    console.log("⏳ Waiting for post-login redirects and page changes...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Take a screenshot if in debug mode
    if (debugMode) {
      try {
        await page.screenshot({
          path: "debug-post-login.png",
          fullPage: true
        });
        console.log("📸 Debug screenshot saved: debug-post-login.png");
      } catch (screenshotError) {
        console.log("⚠️ Could not take debug screenshot:", screenshotError);
      }
    }

    // Check for post-login verification challenges
    console.log("🔍 Checking for post-login verification challenges...");

    const postLoginChecks = await page.evaluate(() => {
      // Check for reCAPTCHA elements
      const reCaptchaElements = [
        document.querySelector(".g-recaptcha"),
        document.querySelector("#g-recaptcha-response"),
        document.querySelector("[data-sitekey]"),
        document.querySelector("iframe[src*='recaptcha']"),
        document.querySelector("iframe[title*='recaptcha']"),
        document.querySelector("iframe[title*='captcha']")
      ].filter(Boolean);

      // Check for any popup/modal that might contain verification
      const popups = [
        document.querySelector(".modal"),
        document.querySelector(".popup"),
        document.querySelector(".overlay"),
        document.querySelector("[class*='modal']"),
        document.querySelector("[class*='popup']"),
        document.querySelector("[style*='position: fixed']")
      ].filter(Boolean);

      // Check all iframes for potential verification content
      const iframes = Array.from(document.querySelectorAll("iframe"));
      const suspiciousIframes = iframes.filter((iframe) => {
        const src = iframe.src || "";
        const title = iframe.title || "";
        return (
          src.includes("captcha") ||
          src.includes("recaptcha") ||
          src.includes("verification") ||
          title.toLowerCase().includes("captcha") ||
          title.toLowerCase().includes("verification")
        );
      });

      // Check for verification-related text on page
      const pageText = document.body.textContent || "";
      const hasVerificationText =
        /verify|verification|captcha|security check|please wait|loading/i.test(
          pageText
        );

      return {
        reCaptchaCount: reCaptchaElements.length,
        reCaptchaElements: reCaptchaElements.map((el) => ({
          tagName: el.tagName,
          className: el.className,
          id: el.id,
          src: (el as any).src || "N/A"
        })),
        popupCount: popups.length,
        popupElements: popups.map((el) => ({
          tagName: el.tagName,
          className: el.className,
          id: el.id,
          style: (el as HTMLElement).style.cssText
        })),
        suspiciousIframes: suspiciousIframes.map((iframe) => ({
          src: iframe.src,
          title: iframe.title,
          className: iframe.className
        })),
        hasVerificationText,
        currentUrl: window.location.href,
        pageTitle: document.title,
        bodyClasses: document.body.className
      };
    });

    console.log(
      "🔍 Post-login verification check:",
      JSON.stringify(postLoginChecks, null, 2)
    );

    // If we detect potential verification challenges, wait longer and try to handle them
    if (
      postLoginChecks.reCaptchaCount > 0 ||
      postLoginChecks.popupCount > 0 ||
      postLoginChecks.suspiciousIframes.length > 0 ||
      postLoginChecks.hasVerificationText
    ) {
      console.log("⚠️ Detected potential post-login verification challenge");
      console.log(`   • reCAPTCHA elements: ${postLoginChecks.reCaptchaCount}`);
      console.log(`   • Popup elements: ${postLoginChecks.popupCount}`);
      console.log(
        `   • Suspicious iframes: ${postLoginChecks.suspiciousIframes.length}`
      );
      console.log(
        `   • Verification text: ${postLoginChecks.hasVerificationText}`
      );

      // Wait longer for verification to complete or become actionable
      console.log("⏳ Waiting for verification challenge to stabilize...");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Look for popup/modal containing reCAPTCHA (similar to quiz reward handling)
      console.log("🔍 Looking for reCAPTCHA popup/modal...");

      // First check if there's a popup/modal that was triggered by login
      console.log("🔍 Checking for post-login popup/modal...");

      // Wait a bit longer for potential popup to appear
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check all frames for reCAPTCHA content
      const frames = await page.frames();
      console.log(`📱 Found ${frames.length} frames on the page`);

      // Log all frame URLs for debugging
      for (let i = 0; i < frames.length; i++) {
        try {
          const frameUrl = frames[i].url();
          console.log(`📱 Frame ${i}: ${frameUrl}`);
        } catch (e) {
          console.log(`📱 Frame ${i}: Unable to access URL`);
        }
      }

      let reCaptchaFrame = null;
      let reCaptchaSiteKey = null;

      // Look for frames that might contain reCAPTCHA
      for (const frame of frames) {
        try {
          const frameUrl = frame.url();
          console.log(`🔍 Checking frame: ${frameUrl}`);

          if (
            frameUrl.includes("recaptcha") ||
            frameUrl.includes("captcha") ||
            frameUrl.includes("verification") ||
            frameUrl.includes("/auth/popup/") ||
            frameUrl.includes("LoginWithCaptcha") ||
            frameUrl.includes("fpSessionAttribute") ||
            (frameUrl.includes("wizard101.com") && frameUrl !== page.url()) ||
            frameUrl !== page.url() // Any iframe could potentially contain captcha
          ) {
            console.log("✅ Found potential reCAPTCHA frame");
            reCaptchaFrame = frame;

            // Try to find site key in this frame or main page
            let frameCheck = await page.evaluate(() => {
              const recaptchaEl = document.querySelector("[data-sitekey]");
              const siteKey = recaptchaEl
                ? recaptchaEl.getAttribute("data-sitekey")
                : null;

              // Also check for site key in script tags
              const scripts = Array.from(document.querySelectorAll("script"));
              let scriptSiteKey = null;
              for (const script of scripts) {
                const content = script.textContent || "";
                const match = content.match(/sitekey['":\s]*['"]([^'"]+)['"]/i);
                if (match) {
                  scriptSiteKey = match[1];
                  break;
                }
              }

              // Look for reCAPTCHA checkbox that needs to be clicked
              const reCaptchaCheckbox = document.querySelector(
                ".recaptcha-checkbox, [role='checkbox'], .rc-anchor-checkbox, .recaptcha-checkbox-border"
              );

              return {
                siteKey: siteKey || scriptSiteKey,
                hasCheckbox: !!reCaptchaCheckbox,
                url: window.location.href
              };
            });

            // If we didn't find site key in main page, try to check inside the frame itself
            if (!frameCheck.siteKey && frame !== page.mainFrame()) {
              try {
                const frameInternalCheck = await frame.evaluate(() => {
                  const recaptchaEl = document.querySelector("[data-sitekey]");
                  const siteKey = recaptchaEl
                    ? recaptchaEl.getAttribute("data-sitekey")
                    : null;

                  // Also check for site key in script tags within frame
                  const scripts = Array.from(
                    document.querySelectorAll("script")
                  );
                  let scriptSiteKey = null;
                  for (const script of scripts) {
                    const content = script.textContent || "";
                    const match = content.match(
                      /sitekey['":\s]*['"]([^'"]+)['"]/i
                    );
                    if (match) {
                      scriptSiteKey = match[1];
                      break;
                    }
                  }

                  // Look for reCAPTCHA checkbox in frame
                  const reCaptchaCheckbox = document.querySelector(
                    ".recaptcha-checkbox, [role='checkbox'], .rc-anchor-checkbox, .recaptcha-checkbox-border"
                  );

                  return {
                    siteKey: siteKey || scriptSiteKey,
                    hasCheckbox: !!reCaptchaCheckbox,
                    url: window.location.href
                  };
                });

                if (frameInternalCheck.siteKey) {
                  console.log(
                    `🔑 Found site key inside frame: ${frameInternalCheck.siteKey}`
                  );
                  frameCheck = frameInternalCheck;
                }
              } catch (frameAccessError) {
                console.log(
                  `⚠️ Could not access frame internals: ${frameAccessError.message}`
                );
              }
            }

            if (frameCheck.siteKey) {
              reCaptchaSiteKey = frameCheck.siteKey;
              console.log(`🔑 Found site key: ${reCaptchaSiteKey}`);

              // Check if this is a visible reCAPTCHA with checkbox
              if (frameCheck.hasCheckbox) {
                console.log("✅ Found visible reCAPTCHA with checkbox");

                // Try to click the "I'm not a robot" checkbox first
                try {
                  console.log(
                    "🖱️ Attempting to click 'I'm not a robot' checkbox..."
                  );

                  // Try clicking checkbox in main page first
                  let checkboxClicked = await page.evaluate(() => {
                    const checkboxSelectors = [
                      ".recaptcha-checkbox",
                      "[role='checkbox']",
                      ".rc-anchor-checkbox",
                      ".recaptcha-checkbox-border"
                    ];

                    for (const selector of checkboxSelectors) {
                      const checkbox = document.querySelector(selector);
                      if (checkbox) {
                        console.log(
                          `🎯 Found checkbox with selector: ${selector}`
                        );
                        (checkbox as HTMLElement).click();
                        return true;
                      }
                    }
                    return false;
                  });

                  // If not found in main page, try clicking in the frame
                  if (
                    !checkboxClicked &&
                    reCaptchaFrame &&
                    reCaptchaFrame !== page.mainFrame()
                  ) {
                    try {
                      console.log("🔄 Trying to click checkbox in frame...");
                      checkboxClicked = await reCaptchaFrame.evaluate(() => {
                        const checkboxSelectors = [
                          ".recaptcha-checkbox",
                          "[role='checkbox']",
                          ".rc-anchor-checkbox",
                          ".recaptcha-checkbox-border"
                        ];

                        for (const selector of checkboxSelectors) {
                          const checkbox = document.querySelector(selector);
                          if (checkbox) {
                            console.log(
                              `🎯 Found checkbox in frame with selector: ${selector}`
                            );
                            (checkbox as HTMLElement).click();
                            return true;
                          }
                        }
                        return false;
                      });
                    } catch (frameClickError) {
                      console.log(
                        `⚠️ Could not click checkbox in frame: ${frameClickError.message}`
                      );
                    }
                  }

                  if (checkboxClicked) {
                    console.log("✅ Successfully clicked reCAPTCHA checkbox");

                    // Wait for challenge to appear
                    console.log("⏳ Waiting for visual challenge to appear...");
                    await new Promise((resolve) => setTimeout(resolve, 3000));

                    // Check if visual challenge appeared (this means we need TwoCaptcha)
                    let challengeAppeared = await page.evaluate(() => {
                      return !!document.querySelector(
                        ".rc-imageselect, .rc-defaultchallenge, .rc-audiochallenge"
                      );
                    });

                    // Also check in frame if not found in main page
                    if (
                      !challengeAppeared &&
                      reCaptchaFrame &&
                      reCaptchaFrame !== page.mainFrame()
                    ) {
                      try {
                        challengeAppeared = await reCaptchaFrame.evaluate(
                          () => {
                            return !!document.querySelector(
                              ".rc-imageselect, .rc-defaultchallenge, .rc-audiochallenge"
                            );
                          }
                        );
                      } catch (frameChallengeError) {
                        console.log(
                          `⚠️ Could not check challenge in frame: ${frameChallengeError.message}`
                        );
                      }
                    }

                    if (challengeAppeared) {
                      console.log(
                        "🎯 Visual challenge appeared, using TwoCaptcha..."
                      );
                    } else {
                      console.log(
                        "✅ No visual challenge - checkbox was sufficient!"
                      );
                      break; // Exit the frame loop
                    }
                  }
                } catch (checkboxError) {
                  console.log("❌ Failed to click checkbox:", checkboxError);
                }
              }
              break; // Found the main reCAPTCHA frame
            }
          }
        } catch (frameError) {
          console.log(`⚠️ Could not access frame: ${frameError.message}`);
          continue;
        }
      }

      // If we found a site key, solve with TwoCaptcha
      if (reCaptchaSiteKey) {
        try {
          console.log("🤖 Using TwoCaptcha to solve reCAPTCHA...");

          const TwoCaptcha = await import("2captcha-ts");
          const solver = new TwoCaptcha.Solver(
            process.env.TWO_CAPTCHA_API_KEY!
          );

          console.log("⏳ Submitting reCAPTCHA to TwoCaptcha...");
          const result = await solver.recaptcha({
            pageurl: page.url(),
            googlekey: reCaptchaSiteKey,
            invisible: false // This is a visible reCAPTCHA
          });

          console.log("✅ TwoCaptcha solved the reCAPTCHA!");
          console.log(`📝 Token: ${result.data.substring(0, 50)}...`);

          // Inject the token into the page
          const injectionResult = await page.evaluate((token) => {
            try {
              // Set g-recaptcha-response in main page
              const responseField = document.getElementById(
                "g-recaptcha-response"
              ) as HTMLTextAreaElement;
              if (responseField) {
                responseField.value = token;
                responseField.innerHTML = token;
                console.log("✅ Token set in g-recaptcha-response field");
              }

              // Look for and call callback function
              if (typeof (window as any).reCaptchaCallback === "function") {
                console.log("📞 Calling reCaptchaCallback...");
                (window as any).reCaptchaCallback(token);
                return "callback_called";
              }

              // Try to submit any forms with the token
              const forms = document.querySelectorAll("form");
              for (const form of forms) {
                const submitButton = form.querySelector(
                  "input[type='submit'], button[type='submit']"
                );
                if (submitButton) {
                  console.log("🖱️ Clicking submit button...");
                  (submitButton as HTMLElement).click();
                  return "form_submitted";
                }
              }

              // Look for continue/close buttons in modals
              const continueButtons = [
                document.querySelector("button[onclick*='continue']"),
                document.querySelector("button[onclick*='close']"),
                document.querySelector(".btn-continue"),
                document.querySelector(".modal-close"),
                document.querySelector("[data-dismiss='modal']")
              ].filter(Boolean);

              if (continueButtons.length > 0) {
                console.log("🖱️ Clicking continue/close button...");
                (continueButtons[0] as HTMLElement).click();
                return "modal_closed";
              }

              return "token_injected";
            } catch (error) {
              return "error: " + (error as Error).message;
            }
          }, result.data);

          console.log("🎯 reCAPTCHA injection result:", injectionResult);

          // Wait for potential redirect or modal close after solving captcha
          await new Promise((resolve) => setTimeout(resolve, 5000));
        } catch (captchaError) {
          console.log("❌ Failed to solve reCAPTCHA:", captchaError);
        }
      } else {
        console.log("❌ Could not find reCAPTCHA site key in any frame");

        // Fallback: Try using known site key for wizard101.com if we detect reCAPTCHA elements
        if (postLoginChecks.reCaptchaCount > 0) {
          console.log(
            "🔄 Attempting fallback with known Wizard101 site key..."
          );

          try {
            const knownSiteKey = "6LfUFE0UAAAAAGoVniwSC9-MtgxlzzAb5dnr9WWY";
            console.log(`🔑 Using known site key: ${knownSiteKey}`);

            const TwoCaptcha = await import("2captcha-ts");
            const solver = new TwoCaptcha.Solver(
              process.env.TWO_CAPTCHA_API_KEY!
            );

            console.log("⏳ Submitting fallback reCAPTCHA to TwoCaptcha...");
            const result = await solver.recaptcha({
              pageurl: page.url(),
              googlekey: knownSiteKey,
              invisible: false // Assume visible reCAPTCHA
            });

            console.log("✅ TwoCaptcha solved fallback reCAPTCHA!");
            console.log(`📝 Token: ${result.data.substring(0, 50)}...`);

            // Inject the token into all possible locations
            const fallbackInjectionResult = await page.evaluate((token) => {
              try {
                let injected = false;

                // Set g-recaptcha-response in main page
                const responseField = document.getElementById(
                  "g-recaptcha-response"
                ) as HTMLTextAreaElement;
                if (responseField) {
                  responseField.value = token;
                  responseField.innerHTML = token;
                  console.log(
                    "✅ Fallback: Token set in g-recaptcha-response field"
                  );
                  injected = true;
                }

                // Look for and call any callback functions
                const possibleCallbacks = [
                  "reCaptchaCallback",
                  "recaptchaCallback",
                  "onRecaptchaCallback",
                  "captchaCallback"
                ];

                for (const callbackName of possibleCallbacks) {
                  if (typeof (window as any)[callbackName] === "function") {
                    console.log(`📞 Fallback: Calling ${callbackName}...`);
                    (window as any)[callbackName](token);
                    injected = true;
                  }
                }

                // Try to submit any forms with submit buttons
                const forms = document.querySelectorAll("form");
                for (const form of forms) {
                  const submitButton = form.querySelector(
                    "input[type='submit'], button[type='submit']"
                  );
                  if (submitButton) {
                    console.log("🖱️ Fallback: Clicking submit button...");
                    (submitButton as HTMLElement).click();
                    injected = true;
                  }
                }

                // Look for modal close/continue buttons
                const modalButtons = [
                  document.querySelector("button[onclick*='continue']"),
                  document.querySelector("button[onclick*='close']"),
                  document.querySelector(".btn-continue"),
                  document.querySelector(".modal-close"),
                  document.querySelector("[data-dismiss='modal']")
                ].filter(Boolean);

                if (modalButtons.length > 0) {
                  console.log("🖱️ Fallback: Clicking modal button...");
                  (modalButtons[0] as HTMLElement).click();
                  injected = true;
                }

                return injected ? "fallback_success" : "fallback_no_action";
              } catch (error) {
                return "fallback_error: " + (error as Error).message;
              }
            }, result.data);

            console.log(
              "🎯 Fallback injection result:",
              fallbackInjectionResult
            );

            // Wait for potential redirect or modal close
            await new Promise((resolve) => setTimeout(resolve, 5000));
          } catch (fallbackError) {
            console.log("❌ Fallback reCAPTCHA solve failed:", fallbackError);
          }
        }
      }
    }

    // Re-check login status after handling potential verification
    const loginVerification = await page.evaluate(() => {
      // Check for logout button or user menu (indicates successful login)
      const logoutButton = document.querySelector(
        '[href*="logout"], [onclick*="logout"], .logout'
      );
      const userMenu = document.querySelector(
        ".user-menu, .user-profile, #user-menu"
      );
      const loginError = document.querySelector(".error, .alert, .warning");

      // Check if still on login page
      const isStillOnLogin =
        !!document.querySelector("#loginUserName") ||
        window.location.href.includes("/login") ||
        document.title.toLowerCase().includes("login");

      // Check for account-related elements that indicate login success
      const hasAccountElements = !!document.querySelector(
        ".account, .user, .member, .player, #account, .myaccount"
      );

      return {
        hasLogoutButton: !!logoutButton,
        hasUserMenu: !!userMenu,
        hasLoginError: !!loginError,
        isStillOnLogin,
        hasAccountElements,
        errorText: loginError ? loginError.textContent?.trim() : null,
        url: window.location.href,
        title: document.title
      };
    });

    console.log("🔍 Final login verification:", loginVerification);

    // Enhanced debugging in debug mode
    if (debugMode) {
      console.log("🔍 Enhanced debug info for login verification:");

      const debugInfo = await page.evaluate(() => {
        return {
          pageTitle: document.title,
          currentUrl: window.location.href,
          bodyClasses: document.body.className,
          hasLoginForm: !!document.querySelector("#loginUserName"),
          hasPasswordField: !!document.querySelector("#loginPassword"),
          hasSubmitButton: !!document.querySelector(
            '#wizardLoginButton input[type="submit"]'
          ),
          loginFormVisible: (() => {
            const form = document.querySelector("#loginUserName");
            if (!form) return false;
            const style = window.getComputedStyle(form);
            return style.display !== "none" && style.visibility !== "hidden";
          })(),
          allFormsCount: document.querySelectorAll("form").length,
          allInputsCount: document.querySelectorAll("input").length,
          pageText:
            document.body.textContent?.substring(0, 500) || "No text found"
        };
      });

      console.log("🔍 Page debug info:", JSON.stringify(debugInfo, null, 2));

      // Take another screenshot for comparison
      try {
        await page.screenshot({
          path: "debug-login-verification.png",
          fullPage: true
        });
        console.log(
          "📸 Login verification screenshot saved: debug-login-verification.png"
        );
      } catch (screenshotError) {
        console.log(
          "⚠️ Could not take login verification screenshot:",
          screenshotError
        );
      }
    }

    if (loginVerification.hasLoginError) {
      throw new Error(`Login failed: ${loginVerification.errorText}`);
    }

    if (loginVerification.isStillOnLogin) {
      console.log(
        "⚠️ Still appears to be on login page after all verification attempts"
      );

      // This indicates login wasn't actually successful
      // The most likely cause is a reCAPTCHA challenge that appeared after login
      console.log("🚨 Login verification failed - authentication incomplete");
      throw new Error(
        "Login verification failed: Still on login page after authentication attempts. " +
          "This likely indicates a reCAPTCHA or other verification challenge that needs to be handled."
      );
    }

    // Test session persistence by making a quick request to a protected page
    console.log("🔒 Testing session persistence...");
    try {
      await page.goto("https://www.wizard101.com/game/account", {
        waitUntil: "networkidle0",
        timeout: 10000
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const sessionTest = await page.evaluate(() => {
        const isLoginPage =
          !!document.querySelector("#loginUserName") ||
          window.location.href.includes("/login");

        // Additional checks for verification challenges
        const hasReCaptcha = !!document.querySelector(
          ".g-recaptcha, [data-sitekey], iframe[src*='recaptcha']"
        );
        const hasModal = !!document.querySelector(
          ".modal, .popup, [class*='modal'], [class*='popup']"
        );

        return {
          isLoginPage,
          hasReCaptcha,
          hasModal,
          url: window.location.href,
          title: document.title
        };
      });

      console.log("🔍 Session test result:", sessionTest);

      if (sessionTest.isLoginPage) {
        // This is a critical failure - authentication is not working
        console.log(
          "🚨 CRITICAL: Session test failed - still redirected to login"
        );

        // Check for reCAPTCHA that might be blocking authentication
        if (sessionTest.hasReCaptcha || sessionTest.hasModal) {
          console.log(
            "🤖 Detected reCAPTCHA/modal on session test - attempting to handle..."
          );

          try {
            await handleReCaptchaChallenge(page);

            // Retry the session test after reCAPTCHA
            console.log("🔄 Retrying session test after reCAPTCHA handling...");
            await page.goto("https://www.wizard101.com/game/account", {
              waitUntil: "networkidle0",
              timeout: 10000
            });

            const retrySessionTest = await page.evaluate(() => {
              const isLoginPage =
                !!document.querySelector("#loginUserName") ||
                window.location.href.includes("/login");
              return {
                isLoginPage,
                url: window.location.href,
                title: document.title
              };
            });

            if (retrySessionTest.isLoginPage) {
              throw new Error(
                "Session test still failed after reCAPTCHA handling"
              );
            }

            console.log("✅ Session test passed after reCAPTCHA handling");
          } catch (recaptchaError) {
            throw new Error(
              `Session test failed with reCAPTCHA: ${recaptchaError}`
            );
          }
        } else {
          throw new Error(
            "Session test failed - redirected to login page (no reCAPTCHA detected)"
          );
        }
      } else {
        console.log("✅ Session persistence test passed");
      }
    } catch (sessionError) {
      console.log("⚠️ Session persistence test failed:", sessionError);
      throw new Error(`Session not properly established: ${sessionError}`);
    }

    // Quick wait and then navigate directly to Earn Crowns page
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Navigate directly to the Earn Crowns page
    console.log("🎯 Navigating directly to Earn Crowns page...");
    await page.goto("https://www.wizard101.com/game/earn-crowns", {
      waitUntil: "networkidle0",
      timeout: 15000
    });

    console.log("✅ Successfully navigated to Earn Crowns page");

    // Start quiz answering
    console.log("\n=== Starting Quiz Session ===");

    // Get all available quizzes
    const allQuizzes = await fetchQuizAnswers();
    console.log(`📚 Available quizzes: ${allQuizzes.length}`);

    // Keep track of successful quizzes
    const targetSuccessfulQuizzes = 10;
    let successfulQuizzes = 0;
    let attemptedQuizzes = 0;
    let consecutiveFailures = 0; // Track consecutive failed attempts
    const maxTotalAttempts = 50; // Safety limit to prevent infinite loops
    const maxConsecutiveFailures = 5; // Exit after 5 consecutive failures

    console.log(`🎯 Target: ${targetSuccessfulQuizzes} successful quizzes`);
    console.log(
      `⚠️ Will exit after ${maxConsecutiveFailures} consecutive failures`
    );

    // Continue until we have enough successful quizzes or hit the safety limit
    while (
      successfulQuizzes < targetSuccessfulQuizzes &&
      attemptedQuizzes < maxTotalAttempts &&
      consecutiveFailures < maxConsecutiveFailures
    ) {
      // Randomly select a quiz from remaining quizzes
      const remainingQuizzes = allQuizzes.filter(() => {
        // You could implement logic here to avoid repeating quizzes if needed
        // For now, we'll allow repeats but shuffle the selection
        return true;
      });

      if (remainingQuizzes.length === 0) {
        console.log("❌ No more quizzes available");
        break;
      }

      const selectedQuiz = getRandomItems(remainingQuizzes, 1)[0];
      attemptedQuizzes++;

      console.log(
        `\n[${successfulQuizzes}/${targetSuccessfulQuizzes} successful] [${attemptedQuizzes} total attempts] [${consecutiveFailures} consecutive failures] Processing: ${selectedQuiz.quiz}`
      );

      const quizSuccess = await answerQuiz(page, selectedQuiz);

      if (quizSuccess) {
        successfulQuizzes++;
        console.log(
          `✅ Quiz completed successfully! (${successfulQuizzes}/${targetSuccessfulQuizzes})`
        );
        consecutiveFailures = 0; // Reset consecutive failures if successful
      } else {
        console.log(`❌ Quiz failed - not counting toward target`);
        consecutiveFailures++; // Increment consecutive failures if quiz fails

        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.log(
            `\n🛑 STOPPING: ${maxConsecutiveFailures} consecutive quiz failures detected`
          );
          console.log(
            `⚠️ This is likely because you have already taken the max number of quizzes for the day.`
          );

          // Update quiz answers in local file before exiting
          if (quizAnswersUpdated) {
            console.log("\n📤 Final sync of quiz answers to local file...");
            try {
              await updateQuizAnswersInLocalFile();
              console.log("✅ Quiz answers successfully synced to local file");
            } catch (error) {
              console.error(
                "❌ Failed to sync quiz answers to local file:",
                error
              );
            }
          }

          // Close browser before exiting
          await browser.close();

          // Exit with failure status
          console.log(
            "💥 Exiting with failure status due to consecutive quiz failures"
          );
          process.exit(1);
        }
      }

      // Wait between quizzes to avoid being too aggressive
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log("\n=== Quiz Session Complete ===");

    if (consecutiveFailures >= maxConsecutiveFailures) {
      console.log(
        `🛑 Session ended due to ${maxConsecutiveFailures} consecutive failures`
      );
      console.log(
        `📊 Completed ${successfulQuizzes} successful quizzes before stopping`
      );
    } else if (successfulQuizzes >= targetSuccessfulQuizzes) {
      console.log(`🎉 Successfully completed ${successfulQuizzes} quizzes!`);
    } else {
      console.log(
        `⚠️ Only completed ${successfulQuizzes}/${targetSuccessfulQuizzes} successful quizzes after ${attemptedQuizzes} attempts`
      );
    }

    // Display final global statistics
    globalStats.totalQuizzes = successfulQuizzes; // Only count successful quizzes

    console.log(`\n${"🎊".repeat(20)}`);
    console.log(`🏆 FINAL SESSION STATISTICS`);
    console.log(`${"🎊".repeat(20)}`);
    console.log(`📊 Overall Performance:`);
    console.log(`   • Total Quizzes Attempted: ${globalStats.totalQuizzes}`);
    console.log(`   • Successful Quizzes: ${globalStats.successfulQuizzes}`);
    console.log(
      `   • Quiz Success Rate: ${
        globalStats.totalQuizzes > 0
          ? (
              (globalStats.successfulQuizzes / globalStats.totalQuizzes) *
              100
            ).toFixed(1)
          : 0
      }%`
    );
    console.log(`\n📝 Question Statistics:`);
    console.log(
      `   • Total Questions Attempted: ${globalStats.totalQuestionsAttempted}`
    );
    console.log(
      `   • Total Questions Answered: ${globalStats.totalQuestionsAnswered}`
    );
    console.log(`   • Questions Skipped: ${globalStats.totalQuestionsSkipped}`);
    console.log(`   • Random Answers: ${globalStats.totalRandomAnswers}`);
    console.log(`   • Database Answers: ${globalStats.totalDatabaseAnswers}`);
    console.log(`   • Gemini AI Answers: ${globalStats.totalGeminiAnswers}`);
    console.log(
      `   • Overall Success Rate: ${
        globalStats.totalQuestionsAttempted > 0
          ? (
              (globalStats.totalQuestionsAnswered /
                globalStats.totalQuestionsAttempted) *
              100
            ).toFixed(1)
          : 0
      }%`
    );

    if (globalStats.totalQuestionsAnswered > 0) {
      console.log(
        `\n💰 Estimated Crowns Earned: ${
          globalStats.totalQuestionsAnswered * 10
        } (assuming 10 crowns per correct answer)`
      );
    }

    console.log(
      `\n🎉 Session completed successfully! Thank you for using the automated quiz system.`
    );
    console.log(`${"🎊".repeat(20)}`);
  } catch (error) {
    console.error("💥 An error occurred:", error);

    // Determine if this is a login-related error that should cause failure
    const errorMessage = (error as Error).message || "";
    const isLoginError =
      errorMessage.includes("Login failed") ||
      errorMessage.includes("session") ||
      errorMessage.includes("authentication") ||
      errorMessage.includes("verification") ||
      errorMessage.includes("Login requires") ||
      errorMessage.includes("Session not properly established");

    // Update quiz answers in local file if any new answers were added (even on error)
    if (quizAnswersUpdated) {
      console.log("\n📤 Final sync of quiz answers to local file...");
      try {
        await updateQuizAnswersInLocalFile();
        console.log("✅ Quiz answers successfully synced to local file");
      } catch (syncError) {
        console.error(
          "❌ Failed to sync quiz answers to local file:",
          syncError
        );
      }
    }

    // Close browser
    await browser.close();

    // Exit with failure status for login-related errors
    if (isLoginError) {
      console.log(
        "💥 Exiting with failure status due to login/authentication error"
      );
      process.exit(1);
    }
  } finally {
    // Ensure browser is closed even if error handling fails
    try {
      await browser.close();
    } catch {
      // Browser may already be closed
    }
  }
}

// Function to test stealth effectiveness (optional)
async function testStealthMode(page: Page): Promise<void> {
  try {
    console.log("🧪 Testing stealth mode effectiveness...");

    // Test basic detection vectors
    const stealthTest = await page.evaluate(() => {
      const results = {
        webdriver: !!(window.navigator as unknown as Record<string, unknown>)
          .webdriver,
        userAgent: navigator.userAgent,
        headless: /HeadlessChrome/.test(navigator.userAgent),
        plugins: navigator.plugins.length,
        languages: navigator.languages,
        chrome: !!(window as unknown as Record<string, unknown>).chrome,
        permissions: typeof navigator.permissions !== "undefined",
        deviceMemory:
          (navigator as unknown as Record<string, unknown>).deviceMemory ||
          "undefined"
      };
      return results;
    });

    console.log("🔍 Stealth test results:");
    console.log(
      `   • WebDriver property: ${
        stealthTest.webdriver ? "❌ DETECTED" : "✅ Hidden"
      }`
    );
    console.log(
      `   • User Agent: ${
        stealthTest.headless ? "❌ Headless detected" : "✅ Normal browser"
      }`
    );
    console.log(`   • Plugins: ${stealthTest.plugins} available`);
    console.log(`   • Languages: ${JSON.stringify(stealthTest.languages)}`);
    console.log(
      `   • Chrome object: ${stealthTest.chrome ? "✅ Present" : "❌ Missing"}`
    );
    console.log(`   • Device Memory: ${stealthTest.deviceMemory}`);
  } catch (error) {
    console.log("⚠️ Stealth test failed:", error);
  }
}

main().catch(console.error);
