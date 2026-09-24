// MeetmindAI Background Service Worker

let sessionState = {
  isRecording: false,
  startTime: null,
  duration: 0,
  charCount: 0,
  mode: 'meet', // 'meet' or 'mic'
  transcript: [],
  lastTranscriptSegment: ''
};

let timerInterval = null;

// Listen for connection status and messaging
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'GET_STATUS':
      sendResponse({
        isRecording: sessionState.isRecording,
        duration: sessionState.duration,
        charCount: sessionState.charCount,
        mode: sessionState.mode,
        lastTranscriptSegment: sessionState.lastTranscriptSegment
      });
      break;

    case 'UPDATE_MODE':
      if (!sessionState.isRecording) {
        sessionState.mode = request.mode;
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Cannot change mode during recording.' });
      }
      break;

    case 'START_SESSION':
      startSession(request.mode);
      sendResponse({ success: true });
      break;

    case 'STOP_SESSION':
      stopSession().then((processedData) => {
        sendResponse({ success: true, data: processedData });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true; // Keep message channel open for async processing

    case 'DISCARD_SESSION':
      discardSession();
      sendResponse({ success: true });
      break;

    case 'TRANSCRIPT_UPDATE':
      if (sessionState.isRecording) {
        handleTranscriptUpdate(request.data);
      }
      sendResponse({ success: true });
      break;

    case 'TEST_API_KEY':
      testApiKey(request.apiKey).then((result) => {
        sendResponse(result);
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true; // Keep channel open
  }
});

// Start tracking meeting
function startSession(mode) {
  if (sessionState.isRecording) return;

  sessionState = {
    isRecording: true,
    startTime: Date.now(),
    duration: 0,
    charCount: 0,
    mode: mode || 'meet',
    transcript: [],
    lastTranscriptSegment: ''
  };

  // Start background duration timer
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    sessionState.duration++;
  }, 1000);

  // Send message to active tab to initiate capturing in the content script
  sendMessageToActiveTab({ action: 'START_CAPTURE', mode: sessionState.mode });
}

// Stop tracking and process transcript
async function stopSession() {
  if (!sessionState.isRecording) return null;

  // Clear timer
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  sessionState.isRecording = false;

  // Stop capturing in content script
  sendMessageToActiveTab({ action: 'STOP_CAPTURE' });

  const finalTranscript = [...sessionState.transcript];
  const meetingDuration = sessionState.duration;
  
  // Format consolidated text
  const fullTranscriptText = finalTranscript.map(line => `[${line.speaker}]: ${line.text}`).join('\n');

  // Trigger AI processing
  let processedData = null;
  try {
    const settings = await getSettings();
    if (settings.geminiKey && finalTranscript.length > 0) {
      // Call Gemini API
      processedData = await analyzeWithGemini(fullTranscriptText, settings.geminiKey);
    } else {
      // Generate Smart Simulated Data (Demo Mode)
      processedData = generateDemoData(finalTranscript, meetingDuration);
    }
  } catch (err) {
    console.error('[MeetmindAI] AI analysis failed, falling back to local processing:', err);
    processedData = generateDemoData(finalTranscript, meetingDuration);
  }

  // Save to chrome storage history
  if (processedData) {
    await saveMeetingToHistory(processedData);
  }

  return processedData;
}

// Discard current session
function discardSession() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  sessionState.isRecording = false;
  
  sendMessageToActiveTab({ action: 'STOP_CAPTURE' });
  
  sessionState = {
    isRecording: false,
    startTime: null,
    duration: 0,
    charCount: 0,
    mode: 'meet',
    transcript: [],
    lastTranscriptSegment: ''
  };
}

// Handle transcription segment updates from content script
function handleTranscriptUpdate(data) {
  const { speaker, text, timestamp } = data;
  
  if (sessionState.transcript.length === 0) {
    sessionState.transcript.push({ speaker, text, timestamp });
  } else {
    const lastEntry = sessionState.transcript[sessionState.transcript.length - 1];
    
    // If same speaker and they spoke recently (within 8 seconds), consolidate the speech bubble
    if (lastEntry.speaker === speaker && (timestamp - lastEntry.timestamp < 8000)) {
      // Avoid duplicating identical text if Google Meet DOM re-sent it
      if (text.startsWith(lastEntry.text)) {
        lastEntry.text = text; // Update to the longer text
      } else if (!lastEntry.text.includes(text)) {
        lastEntry.text += ' ' + text; // Append new unique segment
      }
      lastEntry.timestamp = timestamp; // Keep timestamp fresh
    } else {
      // New speaker or time gap, add new entry
      sessionState.transcript.push({ speaker, text, timestamp });
    }
  }

  // Update stats
  sessionState.lastTranscriptSegment = `[${speaker}]: ${text}`;
  sessionState.charCount = sessionState.transcript.reduce((sum, item) => sum + item.speaker.length + item.text.length + 4, 0);
}

function sendMessageToActiveTab(message) {
  console.log('[MeetmindAI] Broadcasting message:', message);
  chrome.tabs.query({ active: true }, (tabs) => {
    console.log('[MeetmindAI] Found active tabs count:', tabs ? tabs.length : 0);
    if (tabs && tabs.length > 0) {
      tabs.forEach((tab) => {
        console.log('[MeetmindAI] Attempting send to tab:', tab.id, tab.url);
        chrome.tabs.sendMessage(tab.id, message, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[MeetmindAI] Message failed for tab:', tab.id, chrome.runtime.lastError.message);
          } else {
            console.log('[MeetmindAI] Message succeeded for tab:', tab.id, response);
          }
        });
      });
    }
  });
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['geminiKey'], (result) => {
      const settings = result || {};
      if (!settings.geminiKey) {
        settings.geminiKey = '';
      }
      resolve(settings);
    });
  });
}

function saveMeetingToHistory(meetingData) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['meetingHistory'], (result) => {
      const history = result.meetingHistory || [];
      // Add to front of array
      history.unshift(meetingData);
      // Cap history at 30 items to stay within storage limits
      if (history.length > 30) history.pop();
      
      chrome.storage.local.set({ meetingHistory: history }, () => {
        resolve();
      });
    });
  });
}

// --- DYNAMIC MODEL DETECTOR ---
async function getBestModel(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorDetails = response.statusText;
    try {
      const jsonErr = JSON.parse(errorText);
      if (jsonErr.error && jsonErr.error.message) {
        errorDetails = jsonErr.error.message;
      }
    } catch(e) {}
    throw new Error(errorDetails);
  }
  
  const result = await response.json();
  if (!result.models) return 'gemini-1.5-flash';
  
  const modelNames = result.models.map(m => m.name);
  const priority = [
    'models/gemini-3.5-flash',
    'models/gemini-2.5-flash',
    'models/gemini-2.0-flash',
    'models/gemini-1.5-flash',
    'models/gemini-flash-latest'
  ];
  
  for (const model of priority) {
    if (modelNames.includes(model)) {
      return model.replace('models/', '');
    }
  }
  return 'gemini-1.5-flash';
}

// --- GEMINI API INTEGRATION ---
async function analyzeWithGemini(transcriptText, apiKey, modelName = null) {
  if (!modelName) {
    try {
      modelName = await getBestModel(apiKey);
    } catch (e) {
      console.warn('[MeetmindAI] Dynamic model detection failed, using fallback:', e.message);
      modelName = 'gemini-1.5-flash';
    }
  }
  console.log(`[MeetmindAI] Querying with model: ${modelName}`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  
  const systemInstruction = `
    You are MeetmindAI, a highly precise, factual meeting assistant. 
    Analyze the meeting transcript and generate an accurate analysis. You MUST return a single JSON object.
    
    CRITICAL GROUNDING RULES:
    1. STRICT CONTEXT-ONLY: Base all summaries, topics, and action items ONLY on the information explicitly stated in the transcript. 
    2. NO PLACEHOLDERS: Do NOT invent, assume, or hallucinate subjects, projects, tasks, or discussions. If they are not mentioned in the transcript, they do not exist.
    3. NO MOCK SPEAKERS: Only list speakers who actually spoke in the transcript. Never use placeholder names like "Alex", "Sarah", "Marcus", or "Elena" unless they are in the transcript.
    4. NO FAKE CHECKLISTS: Only generate action items that were explicitly discussed and agreed upon. If no action items were discussed, set "actionItems" to [].
    5. BRIEF FOR SHORT TRANSCRIPTS: If the transcript is very short (e.g. only greetings or a few sentences), keep the "summary" to 1-2 simple, factual sentences. Do not expand it into a detailed outline.
    6. TITLE: The title must match the actual topic discussed, or be "Quick Sync" if too short.
    
    The JSON structure MUST be exactly:
    {
      "title": "Meeting Title (short and descriptive)",
      "date": "YYYY-MM-DD",
      "duration": 120, // (duration in seconds)
      "summary": "Factual Markdown summary of the meeting. State exactly what was discussed without any elaboration.",
      "topics": ["Topic A", "Topic B"], // Max 5 keywords actually discussed
      "actionItems": [
        {
          "task": "Specific task description",
          "owner": "Actual speaker name responsible",
          "priority": "High" | "Medium" | "Low",
          "completed": false
        }
      ],
      "analytics": {
        "productivityScore": 85, // Integer 0-100 indicating clarity and outcome
        "insights": "Factual feedback about the call length, speaking time balance, or next steps based ONLY on this transcript.",
        "sentiment": {
          "positive": 60, // Integer percentage
          "neutral": 30, // Integer percentage
          "negative": 10  // Integer percentage (sum should be 100)
        },
        "participation": [
          {
            "speaker": "Actual Speaker Name",
            "talkingPercentage": 100 // Integer percentage
          }
        ]
      }
    }
    
    Do not wrap the JSON output in markdown blocks (like \`\`\`json). Return raw JSON only.
  `;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `Here is the transcript of the meeting:\n\n${transcriptText}`
        }]
      }],
      systemInstruction: {
        parts: [{
          text: systemInstruction
        }]
      },
      generationConfig: {
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    // If the selected model fails, failover to gemini-1.5-flash (unless it's already the fallback)
    if (modelName !== 'gemini-1.5-flash') {
      console.warn(`[MeetmindAI] Model ${modelName} failed, retrying with gemini-1.5-flash fallback...`);
      return analyzeWithGemini(transcriptText, apiKey, 'gemini-1.5-flash');
    }
    throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const rawText = result.candidates[0].content.parts[0].text;
  
  // Clean up and parse JSON
  return JSON.parse(rawText.trim());
}

function generateDemoData(transcript, durationSeconds) {
  const dateStr = new Date().toISOString().split('T')[0];
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // If no transcript was captured, generate a beautiful Mock Meeting demo
  if (!transcript || transcript.length === 0) {
    return {
      id: 'demo_' + Date.now(),
      title: "Project Sync: MeetmindAI Core Architecture",
      date: `${dateStr} ${timeStr}`,
      duration: durationSeconds || 1800,
      summary: `### Executive Summary
The team met to finalize the architectural blueprint for **MeetmindAI**, a Chrome Extension designed to summarize, analyze, and extract action items from virtual meetings.

### Core Discussions
1. **Transcription Layer**: Evaluated using Google Meet's DOM captions vs Web Speech API. Agreed to support both. The Google Meet parser will use a MutationObserver on DOM elements to avoid needing intrusive microphone permissions.
2. **AI Processing Strategy**: Chose Gemini 1.5 Flash due to its high speed, massive context window, and native JSON output capabilities.
3. **Data Security**: Decided that all transcriptions and API keys will be stored locally inside the user's browser context using \`chrome.storage.local\` with no external database overhead.

### Key Milestones
- Complete the manifest V3 configuration.
- Integrate the Web Speech API fallback for local testing.
- Launch the main glassmorphic analytics dashboard.`,
      topics: ["Architecture", "Google Meet", "Gemini API", "Security", "UX Design"],
      actionItems: [
        { task: "Create manifest.json and set up service worker", owner: "Alex Rivera", priority: "High", completed: true },
        { task: "Implement DOM MutationObserver for Google Meet captions", owner: "Sarah Chen", priority: "High", completed: false },
        { task: "Design glassmorphic CSS rules for analytics dashboard", owner: "Marcus Vance", priority: "Medium", completed: false },
        { task: "Securely store Gemini API key in local storage", owner: "Elena Rostova", priority: "High", completed: false },
        { task: "Draft system prompts for meeting summarization", owner: "David Kim", priority: "Medium", completed: false }
      ],
      analytics: {
        productivityScore: 92,
        insights: "Excellent participation balance across frontend, backend, and design leads. The discussion remained 95% on-topic. Recommend scheduling a short design sync next week to solidify UI/UX changes before developing.",
        sentiment: { positive: 70, neutral: 25, negative: 5 },
        participation: [
          { speaker: "Alex Rivera", talkingPercentage: 45 },
          { speaker: "Sarah Chen", talkingPercentage: 25 },
          { speaker: "Marcus Vance", talkingPercentage: 20 },
          { speaker: "Elena Rostova", talkingPercentage: 10 }
        ]
      }
    };
  }

  // If transcript was captured, extract actual speakers and make a smart summary
  const speakers = [...new Set(transcript.map(line => line.speaker))];
  
  // Calculate speaker talking metrics
  const speakerStats = {};
  speakers.forEach(sp => speakerStats[sp] = 0);
  transcript.forEach(line => {
    speakerStats[line.speaker] += line.text.length;
  });
  
  const totalLength = Object.values(speakerStats).reduce((a, b) => a + b, 0);
  const participation = speakers.map(sp => ({
    speaker: sp,
    talkingPercentage: Math.max(5, Math.round((speakerStats[sp] / totalLength) * 100))
  }));

  // Smart extract action items from transcript text
  const actionItems = [];
  const actionKeywords = ['need to', 'should', 'will do', 'task', 'todo', 'action item', 'assign', 'responsible'];
  
  transcript.forEach(line => {
    const textLower = line.text.toLowerCase();
    const hasKeyword = actionKeywords.some(keyword => textLower.includes(keyword));
    
    if (hasKeyword && line.text.length > 20 && actionItems.length < 5) {
      // Find priority based on urgency keywords
      let priority = 'Medium';
      if (textLower.includes('urgent') || textLower.includes('asap') || textLower.includes('immediately')) {
        priority = 'High';
      } else if (textLower.includes('later') || textLower.includes('someday') || textLower.includes('maybe')) {
        priority = 'Low';
      }

      actionItems.push({
        task: line.text.replace(/^[-\s*•]+/, '').trim(),
        owner: line.speaker,
        priority: priority,
        completed: false
      });
    }
  });

  // Fallback default action items if none found
  if (actionItems.length === 0) {
    actionItems.push({
      task: "Review meeting transcript and coordinate follow-up session",
      owner: speakers[0] || "Everyone",
      priority: "Medium",
      completed: false
    });
  }

  // Dynamic Summary creation
  let summaryMarkdown = `### Meeting Summary
*This meeting was analyzed in Demo Mode. Below is the structured outline based on transcript data.*

### Highlights & Main Discussion Points
`;

  transcript.slice(0, 5).forEach(line => {
    summaryMarkdown += `- **${line.speaker}** discussed: "${line.text.substring(0, 80)}${line.text.length > 80 ? '...' : ''}"\n`;
  });

  summaryMarkdown += `\n### Discussion Outline
The meeting ran for **${Math.floor(durationSeconds / 60)} minutes** with active contributions from **${speakers.join(', ')}**. The focus revolved around coordinating technical and design aspects of the active project.`;

  // Sentiment analytics simulation
  let positiveVal = 45;
  let negativeVal = 10;
  
  transcript.forEach(line => {
    const txt = line.text.toLowerCase();
    if (txt.includes('good') || txt.includes('great') || txt.includes('awesome') || txt.includes('perfect') || txt.includes('agree')) {
      positiveVal += 5;
    }
    if (txt.includes('bad') || txt.includes('error') || txt.includes('fail') || txt.includes('disagree') || txt.includes('issue') || txt.includes('problem')) {
      negativeVal += 5;
    }
  });

  positiveVal = Math.min(85, positiveVal);
  negativeVal = Math.min(40, negativeVal);
  const neutralVal = 100 - positiveVal - negativeVal;

  const topics = speakers.slice(0, 3).map(sp => `${sp}'s Input`);
  topics.push("Status Report");

  return {
    id: 'session_' + Date.now(),
    title: `Sync with ${speakers.slice(0, 2).join(' & ') || 'Team'}`,
    date: `${dateStr} ${timeStr}`,
    duration: durationSeconds,
    summary: summaryMarkdown,
    topics: topics.slice(0, 5),
    actionItems: actionItems,
    analytics: {
      productivityScore: Math.min(100, Math.max(50, 75 + Math.round(Math.random() * 20))),
      insights: `The meeting focused heavily on status updates. Speaker ${speakers[0] || '1'} was the primary driver of discussions, representing ${participation[0]?.talkingPercentage || 50}% of total talk time. To improve future meetings, consider dividing responsibilities and allocating equal time slots for each participant.`,
      sentiment: {
        positive: positiveVal,
        neutral: neutralVal,
        negative: negativeVal
      },
      participation: participation
    }
  };
}

// --- API CONNECTION STATUS TESTERS ---
async function testApiKey(apiKey) {
  const modelName = await getBestModel(apiKey);
  console.log(`[MeetmindAI] Testing key with best model: ${modelName}`);
  try {
    const success = await testModelConnection(apiKey, modelName);
    if (success) return { success: true, model: modelName };
  } catch (err) {
    // If the best model failed, try a fallback model
    const fallbackModel = modelName === 'gemini-1.5-flash' ? 'gemini-2.0-flash' : 'gemini-1.5-flash';
    console.warn(`[MeetmindAI] API test failed for ${modelName}, trying fallback ${fallbackModel}:`, err.message);
    try {
      const successFallback = await testModelConnection(apiKey, fallbackModel);
      if (successFallback) return { success: true, model: fallbackModel };
    } catch (errFallback) {
      throw new Error(err.message);
    }
  }
}

async function testModelConnection(apiKey, modelName) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: 'Respond only with: OK'
        }]
      }]
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorDetails = response.statusText;
    try {
      const jsonErr = JSON.parse(errorText);
      if (jsonErr.error && jsonErr.error.message) {
        errorDetails = jsonErr.error.message;
      }
    } catch(e) {}
    throw new Error(errorDetails);
  }
  return true;
}
