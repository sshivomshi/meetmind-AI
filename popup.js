// DOM Elements
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const timerDisplay = document.getElementById('sessionTimer');
const charCountDisplay = document.getElementById('charCount');
const btnAction = document.getElementById('btnAction');
const btnDiscard = document.getElementById('btnDiscard');
const btnModeMeet = document.getElementById('btnModeMeet');
const btnModeMic = document.getElementById('btnModeMic');
const btnDashboard = document.getElementById('btnDashboard');
const previewPanel = document.getElementById('previewPanel');
const previewBox = document.getElementById('previewBox');

// Settings Elements
const btnToggleSettings = document.getElementById('btnToggleSettings');
const settingsContent = document.getElementById('settingsContent');
const geminiKeyInput = document.getElementById('geminiKey');
const btnSaveSettings = document.getElementById('btnSaveSettings');
const btnTestKey = document.getElementById('btnTestKey');
const apiStatusMessage = document.getElementById('apiStatusMessage');

let localTimerInterval = null;
let currentDuration = 0;
let currentMode = 'meet'; // 'meet' or 'mic'

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  updateStatus();
  
  btnTestKey.addEventListener('click', testAPIConnection);
  
  // Update status every second while popup is open
  setInterval(updateStatus, 1000);
});

// Event Listeners
btnAction.addEventListener('click', toggleSession);
btnDiscard.addEventListener('click', discardSession);
btnDashboard.addEventListener('click', openDashboard);

btnModeMeet.addEventListener('click', () => setMode('meet'));
btnModeMic.addEventListener('click', () => setMode('mic'));

btnToggleSettings.addEventListener('click', () => {
  settingsContent.classList.toggle('hidden');
});

btnSaveSettings.addEventListener('click', saveSettings);

// Fetch state from background worker
function updateStatus() {
  chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) return;

    const { isRecording, duration, charCount, mode, lastTranscriptSegment } = response;
    
    // Update Mode Button Active state
    currentMode = mode;
    if (mode === 'meet') {
      btnModeMeet.classList.add('active');
      btnModeMic.classList.remove('active');
    } else {
      btnModeMic.classList.add('active');
      btnModeMeet.classList.remove('active');
    }

    // Disable mode changes while recording
    if (isRecording) {
      btnModeMeet.disabled = true;
      btnModeMic.disabled = true;
      btnDiscard.classList.remove('hidden');
      previewPanel.classList.remove('hidden');
    } else {
      btnModeMeet.disabled = false;
      btnModeMic.disabled = false;
      btnDiscard.classList.add('hidden');
      previewPanel.classList.add('hidden');
    }

    // Update Action Button
    if (isRecording) {
      statusBadge.classList.add('active');
      statusText.textContent = 'Listening';
      
      btnAction.classList.add('recording');
      btnAction.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
        </svg>
        <span>Stop & Process</span>
      `;
    } else {
      statusBadge.classList.remove('active');
      statusText.textContent = 'Idle';
      
      btnAction.classList.remove('recording');
      btnAction.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        <span>Start Capture</span>
      `;
    }

    // Update Timer & Stats
    currentDuration = duration;
    timerDisplay.textContent = formatTime(duration);
    charCountDisplay.textContent = charCount.toLocaleString();

    // Update Live Preview Box
    if (isRecording && lastTranscriptSegment) {
      previewBox.innerHTML = `<p>${lastTranscriptSegment}</p>`;
      previewBox.scrollTop = previewBox.scrollHeight;
    } else if (!isRecording) {
      previewBox.innerHTML = `<p class="placeholder-text">Waiting for speaking to begin...</p>`;
    }
  });
}

function setMode(mode) {
  if (statusBadge.classList.contains('active')) return; // No mode change during recording
  
  currentMode = mode;
  chrome.runtime.sendMessage({ action: 'UPDATE_MODE', mode }, () => {
    updateStatus();
  });
}

function toggleSession() {
  chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) return;

    if (response.isRecording) {
      // Stop session
      btnAction.disabled = true;
      btnAction.innerHTML = `<span>Processing AI...</span>`;
      chrome.runtime.sendMessage({ action: 'STOP_SESSION' }, (stopResponse) => {
        btnAction.disabled = false;
        updateStatus();
        // Redirect to dashboard immediately to show summary
        openDashboard();
      });
    } else {
      // Start session
      chrome.runtime.sendMessage({ action: 'START_SESSION', mode: currentMode }, () => {
        updateStatus();
      });
    }
  });
}

function discardSession() {
  if (confirm('Are you sure you want to discard this meeting session? Nothing will be saved.')) {
    chrome.runtime.sendMessage({ action: 'DISCARD_SESSION' }, () => {
      updateStatus();
    });
  }
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
}

// Helpers
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function saveSettings() {
  const geminiKey = geminiKeyInput.value.trim();
  chrome.storage.local.set({ geminiKey }, () => {
    alert('Settings saved successfully!');
    settingsContent.classList.add('hidden');
  });
}

function loadSettings() {
  chrome.storage.local.get(['geminiKey'], (result) => {
    if (result.geminiKey) {
      geminiKeyInput.value = result.geminiKey;
    }
  });
}

function testAPIConnection() {
  const apiKey = geminiKeyInput.value.trim();
  if (!apiKey) {
    showAPIStatus('Please enter an API key first.', 'error');
    return;
  }

  showAPIStatus('Testing connection...', 'pending');

  chrome.runtime.sendMessage({ action: 'TEST_API_KEY', apiKey }, (response) => {
    if (chrome.runtime.lastError) {
      showAPIStatus('Service worker communication failed.', 'error');
      return;
    }

    if (response && response.success) {
      showAPIStatus(`Connected! (Model: ${response.model})`, 'success');
    } else {
      const errorMsg = response ? response.error : 'Unknown response from server';
      showAPIStatus(`Error: ${errorMsg}`, 'error');
    }
  });
}

function showAPIStatus(message, type) {
  apiStatusMessage.style.display = 'block';
  apiStatusMessage.textContent = message;
  
  if (type === 'success') {
    apiStatusMessage.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
    apiStatusMessage.style.color = '#10b981';
    apiStatusMessage.style.border = '1px solid rgba(16, 185, 129, 0.3)';
  } else if (type === 'error') {
    apiStatusMessage.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    apiStatusMessage.style.color = '#ef4444';
    apiStatusMessage.style.border = '1px solid rgba(239, 68, 68, 0.3)';
  } else {
    apiStatusMessage.style.backgroundColor = 'rgba(245, 158, 11, 0.12)';
    apiStatusMessage.style.color = '#fbbf24';
    apiStatusMessage.style.border = '1px solid rgba(245, 158, 11, 0.2)';
  }
}
