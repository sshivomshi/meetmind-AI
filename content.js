// MeetmindAI Content Script
console.log('[MeetmindAI] Content script injected and active.');

let captionObserver = null;
let scraperInterval = null;
let recognition = null;
let lastSpeaker = '';
let lastSentText = '';

// Listen for messages from background/popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_CAPTURE') {
    if (request.mode === 'meet') {
      startMeetScraper();
    } else {
      startMicCapture();
    }
    sendResponse({ success: true });
  } else if (request.action === 'STOP_CAPTURE') {
    stopMeetScraper();
    stopMicCapture();
    sendResponse({ success: true });
  }
});

// --- GOOGLE MEET SCRAPER ---
function ensureMeetCaptionsEnabled() {
  const btn = document.querySelector('button[aria-label*="caption"], [aria-label*="Caption"]');
  if (btn) {
    const isPressed = btn.getAttribute('aria-pressed') === 'true';
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const isOff = !isPressed || label.includes('turn on');
    if (isOff) {
      console.log('[MeetmindAI] Captions are off. Auto-enabling captions...');
      btn.click();
    }
  } else {
    console.warn('[MeetmindAI] Could not find Google Meet captions button. Please enable captions manually.');
  }
}

function startMeetScraper() {
  console.log('[MeetmindAI] Starting Google Meet caption scraper directly on body...');
  
  // Auto-enable Google Meet captions if currently off
  ensureMeetCaptionsEnabled();

  if (captionObserver) {
    captionObserver.disconnect();
  }

  // Observe body for additions of caption text segments
  captionObserver = new MutationObserver((mutations) => {
    // DIAGNOSTIC LOGGING: Inspect mutations to find Google's caption container structure
    mutations.forEach(mutation => {
      // 1. Check in-place text modifications (characterData updates)
      if (mutation.type === 'characterData') {
        const text = mutation.target.textContent.trim();
        const parent = mutation.target.parentElement;
        if (text && (text.includes('Singh') || text.includes('team') || text.includes('dashboard') || text.includes('interview') || text.length > 15)) {
          console.log('[MeetmindAI] DIAGNOSTIC - Text mutated:', {
            text: text,
            parentTag: parent ? parent.tagName : 'NONE',
            parentClass: parent ? parent.className : 'NONE',
            parentJsName: parent ? parent.getAttribute('jsname') : 'NONE',
            parentJsController: parent ? parent.getAttribute('jscontroller') : 'NONE',
            parentOuterHTML: parent ? parent.outerHTML.substring(0, 200) : 'NONE'
          });
        }
      }
      
      // 2. Check child node additions
      if (mutation.addedNodes && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const nodeText = node.textContent.trim();
            if (nodeText && (nodeText.includes('Singh') || nodeText.includes('team') || nodeText.includes('dashboard') || nodeText.includes('interview') || nodeText.length > 15)) {
              console.log('[MeetmindAI] DIAGNOSTIC - Element added:', {
                tagName: node.tagName,
                className: node.className,
                jsname: node.getAttribute ? node.getAttribute('jsname') : null,
                jscontroller: node.getAttribute ? node.getAttribute('jscontroller') : null,
                textContent: nodeText.substring(0, 100),
                outerHTML: node.outerHTML.substring(0, 200)
              });
            }
          } else if (node.nodeType === Node.TEXT_NODE) {
            const nodeText = node.textContent.trim();
            if (nodeText && (nodeText.includes('Singh') || nodeText.includes('team') || nodeText.includes('dashboard') || nodeText.includes('interview') || nodeText.length > 15)) {
              console.log('[MeetmindAI] DIAGNOSTIC - Text node added:', {
                text: nodeText,
                parentTag: node.parentElement ? node.parentElement.tagName : 'NONE',
                parentClass: node.parentElement ? node.parentElement.className : 'NONE'
              });
            }
          }
        });
      }
    });

    // Google Meet caption text nodes always have jsname="ysn3ld", class*="iTtpfd", or are inside captions region
    const textNodes = document.querySelectorAll('[jsname="ysn3ld"], [class*="iTtpfd"], [role="region"][aria-label="Captions"] span');
    
    textNodes.forEach((node) => {
      const text = node.textContent.trim();
      if (!text) return;
      
      // Find the closest speaker block wrapper (using generic tag-less selectors)
      const block = node.closest('[jsname="W22Opb"], [class*="zs7s8d"]');
      let speaker = 'Speaker';
      
      if (block) {
        // Try finding speaker name in standard name container class (.gVcuSb)
        const speakerNode = block.querySelector('.gVcuSb, [class*="gVcuSb"]');
        if (speakerNode && speakerNode.textContent.trim()) {
          speaker = speakerNode.textContent.trim();
        } else {
          // Fallback: use first child div text in the block wrapper
          const firstDiv = block.querySelector('div');
          if (firstDiv && firstDiv.textContent.trim()) {
            speaker = firstDiv.textContent.trim();
          }
        }
      }
      
      // Verify if text segment is new or updated
      if (text && (speaker !== lastSpeaker || text !== lastSentText)) {
        sendTranscriptSegment(speaker, text);
        lastSpeaker = speaker;
        lastSentText = text;
      }
    });
  });

  // Observe document body for changes in child nodes, subtree, and text
  captionObserver.observe(document.body, { 
    childList: true, 
    subtree: true,
    characterData: true
  });
  
  // Set up backup polling interval running every 500ms
  if (scraperInterval) {
    clearInterval(scraperInterval);
  }
  scraperInterval = setInterval(scrapeCaptions, 500);
  
  console.log('[MeetmindAI] Scraper observer and polling attached.');
}

function scrapeCaptions() {
  // Query only actual Google Meet caption nodes
  const elements = document.querySelectorAll('[jsname="ysn3ld"], [class*="iTtpfd"], [role="region"][aria-label="Captions"] span');
  const viewportHeight = window.innerHeight;
  
  elements.forEach((el) => {
    // Check if the element contains text and doesn't have too many descendants (ignore large structural wrappers)
    if (!el.textContent || el.children.length > 3) return;
    
    const rect = el.getBoundingClientRect();
    
    // If in the main top window, captions are always in the lower-third zone.
    // If inside a sub-frame, skip this check as the iframe itself is the caption area container.
    const isTopFrame = window === window.top;
    if (isTopFrame && rect.top < (window.innerHeight * 0.65)) {
      return;
    }
    
    const text = el.textContent.trim();
    // Avoid single-character noise but keep short utterances like "Yes", "No", "Ok"
    if (text.length < 2 || text.length > 400) return;
    
    // We found an active caption element! Now let's resolve the speaker:
    let speaker = 'Speaker';
    let foundSpeaker = false;
    let parent = el.parentElement;
    
    // Walk up 3 parent nodes to look for standard speaker label class or sibling name elements
    for (let i = 0; i < 3 && parent; i++) {
      const possibleSpeaker = parent.querySelector('.gVcuSb, [class*="gVcuSb"], [class*="zs7s8d"]');
      if (possibleSpeaker && possibleSpeaker.textContent.trim()) {
        const sText = possibleSpeaker.textContent.trim();
        if (sText.length > 0 && sText.length < 40 && sText !== text) {
          speaker = sText;
          foundSpeaker = true;
          break;
        }
      }
      parent = parent.parentElement;
    }
    
    // Fallback: Check if the text matches standard prefix or if last speaker was "You"
    if (!foundSpeaker && el.previousElementSibling) {
      const sibText = el.previousElementSibling.textContent.trim();
      if (sibText && sibText.length > 0 && sibText.length < 30) {
        speaker = sibText;
      }
    }
    
    // Clean speaker name
    if (speaker === 'You') speaker = 'You'; 
    
    // Send segment if new or updated
    if (text && (speaker !== lastSpeaker || text !== lastSentText)) {
      sendTranscriptSegment(speaker, text);
      lastSpeaker = speaker;
      lastSentText = text;
    }
  });
}

function stopMeetScraper() {
  if (captionObserver) {
    captionObserver.disconnect();
    captionObserver = null;
  }
  if (scraperInterval) {
    clearInterval(scraperInterval);
    scraperInterval = null;
  }
  console.log('[MeetmindAI] Google Meet caption scraper stopped.');
}

// --- MICROPHONE CAPTURE (WEB SPEECH API) ---
function startMicCapture() {
  console.log('[MeetmindAI] Starting generic Mic capture via Web Speech API...');
  
  if (recognition) {
    try { recognition.stop(); } catch(e) {}
  }

  window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!window.SpeechRecognition) {
    alert('Web Speech API is not supported in this browser. Please use Google Meet mode.');
    return;
  }

  recognition = new window.SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    console.log('[MeetmindAI] Microphone recognition active.');
  };

  recognition.onerror = (event) => {
    console.error('[MeetmindAI] Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      alert('Microphone permission denied. Please allow microphone access to use Mic Mode.');
    }
  };

  recognition.onend = () => {
    console.log('[MeetmindAI] Microphone recognition service disconnected.');
    // If we're still recording, restart recognition
    chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (response) => {
      if (response && response.isRecording && response.mode === 'mic') {
        try { recognition.start(); } catch(e) {}
      }
    });
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    const textToSend = finalTranscript || interimTranscript;
    if (textToSend.trim()) {
      sendTranscriptSegment('Speaker (Mic)', textToSend);
    }
  };

  try {
    recognition.start();
  } catch (err) {
    console.error('[MeetmindAI] Failed to start speech recognition:', err);
  }
}

function stopMicCapture() {
  if (recognition) {
    try {
      recognition.stop();
    } catch(e) {}
    recognition = null;
  }
  console.log('[MeetmindAI] Mic capture stopped.');
}

// Send transcript segments to background script
function sendTranscriptSegment(speaker, text) {
  chrome.runtime.sendMessage({
    action: 'TRANSCRIPT_UPDATE',
    data: {
      speaker: speaker,
      text: text,
      timestamp: Date.now()
    }
  });
}
