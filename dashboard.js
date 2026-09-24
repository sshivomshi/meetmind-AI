// MeetmindAI Dashboard Logic & UI Animations

// State
let meetings = [];
let activeMeetingId = null;

// DOM Elements
const historyList = document.getElementById('historyList');
const meetingDetails = document.getElementById('meetingDetails');
const welcomePanel = document.getElementById('welcomePanel');
const btnClearHistory = document.getElementById('btnClearHistory');
const btnTriggerDemo = document.getElementById('btnTriggerDemo');
const btnOpenSession = document.getElementById('btnOpenSession');

// Meeting Details DOM Elements
const meetTitle = document.getElementById('meetTitle');
const meetDateSpan = document.querySelector('#meetDate span');
const meetDurationSpan = document.querySelector('#meetDuration span');
const scoreNum = document.getElementById('scoreNum');
const scoreRingPath = document.getElementById('scoreRingPath');
const summaryContent = document.getElementById('summaryContent');
const actionCount = document.getElementById('actionCount');
const actionList = document.getElementById('actionList');
const btnDeleteMeeting = document.getElementById('btnDeleteMeeting');

// Analytics DOM Elements
const sentimentPos = document.getElementById('sentimentPos');
const sentimentNeu = document.getElementById('sentimentNeu');
const sentimentNeg = document.getElementById('sentimentNeg');
const participationChart = document.getElementById('participationChart');
const topicsCloud = document.getElementById('topicsCloud');

// Cross-environment Storage Helper (Chrome Extension Storage & Web localStorage fallback)
const storage = {
  get(keys, callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(keys, callback);
    } else {
      const result = {};
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach(k => {
        try {
          const val = localStorage.getItem(k);
          result[k] = val ? JSON.parse(val) : null;
        } catch(e) {
          result[k] = null;
        }
      });
      callback(result);
    }
  },
  set(obj, callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(obj, callback);
    } else {
      Object.keys(obj).forEach(k => {
        try {
          localStorage.setItem(k, JSON.stringify(obj[k]));
        } catch(e) {}
      });
      if (callback) callback();
    }
  },
  remove(keys, callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(keys, callback);
    } else {
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach(k => {
        try { localStorage.removeItem(k); } catch(e) {}
      });
      if (callback) callback();
    }
  }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Load meetings from storage
  loadMeetings();

  // Listen for storage changes if chrome extension environment
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.meetingHistory) {
        loadMeetings();
      }
    });
  }

  // Action Buttons
  if (btnClearHistory) btnClearHistory.addEventListener('click', clearHistory);
  if (btnTriggerDemo) btnTriggerDemo.addEventListener('click', generateDemoSession);
  
  if (btnDeleteMeeting) {
    btnDeleteMeeting.addEventListener('click', deleteActiveMeeting);
  }
  
  if (btnOpenSession) {
    btnOpenSession.addEventListener('click', () => {
      alert('MeetmindAI runs directly in your browser. Download the extension ZIP from the header, load it in chrome://extensions, open Google Meet, and click "Start Capture"!');
    });
  }

  // Set up animations & clock
  initThemeAnimations();
});

// Default Mock Meeting for Web Demo Visitor
const DEFAULT_WEB_MEETING = {
  id: 'demo_initial_session',
  title: 'Q3 AI Co-pilot Architecture & Hackathon Demo Sync',
  date: new Date().toISOString().split('T')[0] + ' 10:30 AM',
  duration: 2540,
  score: 94,
  summary: "### Executive Summary\n- Demonstrated **MeetmindAI** real-time meeting transcription and automated key decision extraction.\n- Validated Chrome Extension Manifest V3 background service worker stream pipeline.\n- Configured **Gemini Flash AI** for low-latency sentiment scoring and participant time distribution tracking.\n\n### Strategic Takeaways\n1. Chrome extension captures speaker labels directly from live DOM mutation observers.\n2. Summaries are automatically cached and synchronized across the workspace dashboard.\n3. Zero reliance on heavy external server infra—privacy-first local execution.",
  actionItems: [
    { text: 'Deploy hosted workspace dashboard to GitHub Pages for hackathon judges', assignee: 'Alex Rivera', done: true },
    { text: 'Publish Chrome Extension .zip artifact release bundle', assignee: 'Engineering Team', done: true },
    { text: 'Conduct end-to-end Google Meet live caption transcription test', assignee: 'QA Lead', done: true }
  ],
  sentiment: { positive: 80, neutral: 15, negative: 5 },
  participants: [
    { name: 'Alex Rivera (Presenter)', percent: 50, color: '#10B981' },
    { name: 'Sarah Chen (Lead Architect)', percent: 30, color: '#3B82F6' },
    { name: 'David Kim (UI Design)', percent: 20, color: '#8B5CF6' }
  ],
  topics: ['Gemini AI', 'Chrome Extension', 'Manifest V3', 'Real-time Audio Scraper', 'Workspace Analytics']
};

// Load meetings from storage
function loadMeetings() {
  storage.get(['meetingHistory'], (result) => {
    meetings = result.meetingHistory;

    // If web environment and no meeting history exists yet, populate default demo meeting
    if ((!meetings || meetings.length === 0) && (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id)) {
      meetings = [DEFAULT_WEB_MEETING];
      storage.set({ meetingHistory: meetings });
    } else {
      meetings = meetings || [];
    }

    renderSidebar();

    if (meetings.length > 0) {
      welcomePanel.classList.add('hidden');
      meetingDetails.classList.remove('hidden');
      
      // Select the active or newest meeting
      if (activeMeetingId && meetings.some(m => m.id === activeMeetingId)) {
        showMeetingDetails(activeMeetingId);
      } else {
        showMeetingDetails(meetings[0].id);
      }
    } else {
      welcomePanel.classList.remove('hidden');
      meetingDetails.classList.add('hidden');
    }
    
    // Refresh scroll reveals for newly injected elements
    refreshRevealObservers();
  });
}

// Render sidebar listing
function renderSidebar() {
  historyList.innerHTML = '';
  
  if (meetings.length === 0) {
    historyList.innerHTML = `
      <div class="text-center text-gray-500 py-12 text-sm italic">
        No meetings captured yet.
      </div>
    `;
    return;
  }

  meetings.forEach((meeting) => {
    const item = document.createElement('div');
    // Align with our .log-item CSS styling
    item.className = `log-item p-4 rounded-2xl border border-white/5 cursor-pointer transition-all duration-300 flex flex-col gap-1 ${meeting.id === activeMeetingId ? 'active' : ''}`;
    item.dataset.id = meeting.id;

    const formattedDuration = formatDuration(meeting.duration);

    item.innerHTML = `
      <h4 class="text-sm font-semibold text-white truncate">${escapeHtml(meeting.title)}</h4>
      <div class="flex justify-between items-center text-[11px] text-gray-400 font-mono mt-1">
        <span>${escapeHtml(meeting.date.split(' ')[0])}</span>
        <span class="text-[#10B981] font-semibold">${formattedDuration}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      showMeetingDetails(meeting.id);
    });

    historyList.appendChild(item);
  });
}

// Display selected meeting data
function showMeetingDetails(id) {
  activeMeetingId = id;
  const meeting = meetings.find(m => m.id === id);
  if (!meeting) return;

  // Highlight active sidebar item
  document.querySelectorAll('.log-item').forEach(item => {
    if (item.dataset.id === id) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Header meta
  meetTitle.textContent = meeting.title;
  meetDateSpan.textContent = meeting.date;
  meetDurationSpan.textContent = formatDuration(meeting.duration);

  // Score widget
  const score = meeting.analytics.productivityScore || 70;
  scoreNum.textContent = score;
  scoreRingPath.setAttribute('stroke-dasharray', `${score}, 100`);

  // Summary rendering
  summaryContent.innerHTML = parseMarkdown(meeting.summary);

  // Action Items Checklist
  renderActionItems(meeting);

  // Sentiment Analytics
  const sent = meeting.analytics.sentiment || { positive: 50, neutral: 40, negative: 10 };
  sentimentPos.style.width = `${sent.positive}%`;
  sentimentPos.textContent = `POS ${sent.positive}%`;
  sentimentNeu.style.width = `${sent.neutral}%`;
  sentimentNeu.textContent = `NEU ${sent.neutral}%`;
  sentimentNeg.style.width = `${sent.negative}%`;
  sentimentNeg.textContent = `NEG ${sent.negative}%`;

  // Participation chart
  renderParticipation(meeting.analytics.participation || []);

  // Topics Tag Cloud
  renderTopics(meeting.topics || []);

  // AI Dynamics Recommendations
  const aiInsights = document.getElementById('aiInsights');
  if (aiInsights) {
    aiInsights.textContent = meeting.analytics.insights || "No dynamics recommendations generated for this session.";
  }
}

// Render checklists
function renderActionItems(meeting) {
  actionList.innerHTML = '';
  const items = meeting.actionItems || [];
  
  const pendingCount = items.filter(item => !item.completed).length;
  actionCount.textContent = `${pendingCount} Pending`;

  if (items.length === 0) {
    actionList.innerHTML = '<li class="text-center text-gray-500 py-8 text-sm italic">No action items detected.</li>';
    return;
  }

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = `task-row flex items-start gap-4 p-4 rounded-2xl border border-white/5 transition-all duration-300 ${item.completed ? 'completed' : ''}`;
    
    li.innerHTML = `
      <input type="checkbox" class="w-5 h-5 rounded border border-white/20 bg-white/5 cursor-pointer accent-[#10B981] mt-0.5" ${item.completed ? 'checked' : ''} data-index="${index}">
      <div class="flex-1 flex flex-col gap-2">
        <span class="task-text text-sm text-gray-200 leading-relaxed">${escapeHtml(item.task)}</span>
        <div class="flex gap-2 items-center text-[10px] font-mono">
          <span class="text-gray-400 bg-white/5 px-2 py-0.5 rounded border border-white/5">${escapeHtml(item.owner || 'Unassigned')}</span>
          <span class="px-2 py-0.5 rounded border ${getPriorityClass(item.priority)}">${escapeHtml(item.priority)}</span>
        </div>
      </div>
    `;

    // Connect checkbox listener
    const checkbox = li.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', (e) => {
      toggleActionItemCompletion(meeting.id, index, e.target.checked);
    });

    actionList.appendChild(li);
  });
}

function getPriorityClass(priority) {
  switch (priority.toLowerCase()) {
    case 'high':
      return 'bg-red-500/10 border-red-500/20 text-red-400';
    case 'medium':
      return 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400';
    default:
      return 'bg-blue-500/10 border-blue-500/20 text-blue-400';
  }
}

// Update Action Item Check state in chrome storage
function toggleActionItemCompletion(meetingId, index, isCompleted) {
  const meetingIndex = meetings.findIndex(m => m.id === meetingId);
  if (meetingIndex === -1) return;

  meetings[meetingIndex].actionItems[index].completed = isCompleted;
  
  chrome.storage.local.set({ meetingHistory: meetings }, () => {
    // Re-render checklist stats
    const meeting = meetings[meetingIndex];
    const pendingCount = meeting.actionItems.filter(item => !item.completed).length;
    actionCount.textContent = `${pendingCount} Pending`;
    
    // Toggle row class
    const rows = actionList.querySelectorAll('.task-row');
    if (rows[index]) {
      rows[index].classList.toggle('completed', isCompleted);
    }
  });
}

// Render talking distribution
function renderParticipation(participationList) {
  participationChart.innerHTML = '';
  
  if (participationList.length === 0) {
    participationChart.innerHTML = '<div class="text-center text-gray-500 py-6 text-sm italic">No talking metrics.</div>';
    return;
  }

  // Sort by highest talking percentage
  const sorted = [...participationList].sort((a,b) => b.talkingPercentage - a.talkingPercentage);

  sorted.forEach(p => {
    const row = document.createElement('div');
    row.className = 'flex flex-col gap-1.5';
    row.innerHTML = `
      <div class="flex justify-between items-center text-xs font-mono">
        <span class="text-gray-300">${escapeHtml(p.speaker)}</span>
        <strong class="text-white">${p.talkingPercentage}%</strong>
      </div>
      <div class="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div class="h-full bg-gradient-to-r from-[#A7F3D0] to-[#10B981] rounded-full" style="width: ${p.talkingPercentage}%"></div>
      </div>
    `;
    participationChart.appendChild(row);
  });
}

// Render topics tags
function renderTopics(topics) {
  topicsCloud.innerHTML = '';
  if (topics.length === 0) {
    topicsCloud.innerHTML = '<span class="text-gray-500 text-xs italic">No topics.</span>';
    return;
  }

  topics.forEach(t => {
    const tag = document.createElement('span');
    tag.className = 'text-[10px] font-mono font-semibold text-white/80 bg-white/5 border border-white/10 px-3 py-1 rounded-full uppercase hover:border-[#10B981]/50 transition-colors duration-300';
    tag.textContent = `# ${t}`;
    topicsCloud.appendChild(tag);
  });
}

// Clear database
function clearHistory() {
  if (confirm('Are you sure you want to delete all meetings from your workspace? This cannot be undone.')) {
    storage.remove(['meetingHistory'], () => {
      meetings = [];
      activeMeetingId = null;
      loadMeetings();
    });
  }
}

// Delete selected active meeting
function deleteActiveMeeting() {
  if (!activeMeetingId) return;

  if (confirm('Are you sure you want to delete this meeting? This cannot be undone.')) {
    const updatedMeetings = meetings.filter(m => m.id !== activeMeetingId);
    
    storage.set({ meetingHistory: updatedMeetings }, () => {
      activeMeetingId = null;
      loadMeetings();
    });
  }
}

// Generate demo session
function generateDemoSession() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'START_SESSION', mode: 'meet' }, () => {
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'STOP_SESSION' }, () => {
          loadMeetings();
        });
      }, 1200);
    });
  } else {
    // Web Mode Demo Session Generator
    const titles = [
      'Sprint 14 Retrospective & Technical Debt Review',
      'AI Multimodal Feature Design & API Benchmarks',
      'Product Launch Go-To-Market Roadmap Sync',
      'Security Audit & Data Privacy Compliance Review'
    ];
    const randomTitle = titles[Math.floor(Math.random() * titles.length)];
    const newDemo = {
      id: 'demo_' + Date.now(),
      title: randomTitle,
      date: new Date().toISOString().split('T')[0] + ' ' + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
      duration: Math.floor(Math.random() * 1200) + 600,
      score: Math.floor(Math.random() * 15) + 85,
      summary: `### Executive Summary\n- Analyzed real-time speaker distribution and key discussion highlights for **${randomTitle}**.\n- Identified 3 high-priority action items for immediate technical execution.\n- Validated latency and response times using Gemini AI synthesis.`,
      actionItems: [
        { text: 'Review and approve pull request for Manifest V3 background service worker', assignee: 'Lead Dev', done: false },
        { text: 'Finalize presentation slides for hackathon demo showcase', assignee: 'Product Lead', done: true },
        { text: 'Optimize vector search embedding cache for transcript history', assignee: 'AI Engineer', done: false }
      ],
      sentiment: { positive: 75, neutral: 20, negative: 5 },
      participants: [
        { name: 'Alex Rivera', percent: 45, color: '#10B981' },
        { name: 'Sarah Chen', percent: 35, color: '#3B82F6' },
        { name: 'David Kim', percent: 20, color: '#8B5CF6' }
      ],
      topics: ['Google Meet', 'Gemini AI', 'Manifest V3', 'Hackathon Demo']
    };

    storage.get(['meetingHistory'], (result) => {
      const current = result.meetingHistory || [];
      current.unshift(newDemo);
      storage.set({ meetingHistory: current }, () => {
        loadMeetings();
      });
    });
  }
}

// Helpers
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins} mins`;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Markdown to HTML renderer
function parseMarkdown(md) {
  if (!md) return '';
  let html = md;
  
  // Headers (e.g. ### Header)
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h3>$1</h3>');
  
  // Bold (e.g. **text**)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Bullet Lists
  html = html.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/^\s*\*\s+(.*$)/gim, '<li>$1</li>');
  
  // Wrap list items in <ul> blocks
  html = html.replace(/(<li>.*<\/li>)/gms, '<ul>$1</ul>');
  
  // Paragraphs
  const blocks = html.split(/\n\n+/);
  const formattedBlocks = blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<li>')) {
      return trimmed;
    }
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  });
  
  return formattedBlocks.join('\n');
}

// --- THEME ANIMATIONS & CLOCK LOGIC ---
let revealObserver = null;

function initThemeAnimations() {
  // 1. Clock timer
  function updateTime() {
    const clockEl = document.getElementById('current-time');
    if (!clockEl) return;
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    clockEl.textContent = `${hours}:${minutes} ${ampm}`;
  }
  setInterval(updateTime, 60000);
  updateTime();

  // 2. Navbar transition on Scroll
  const nav = document.getElementById('main-nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      nav.classList.add('py-4', 'bg-[#050505]/80', 'backdrop-blur-md', 'border-b', 'border-white/5');
      nav.classList.remove('py-8', 'bg-transparent');
    } else {
      nav.classList.remove('py-4', 'bg-[#050505]/80', 'backdrop-blur-md', 'border-b', 'border-white/5');
      nav.classList.add('py-8', 'bg-transparent');
    }
  });

  // 3. Parallax scroll offsets
  window.addEventListener('scroll', () => {
    const scrolled = window.scrollY;
    // Move cards in opposite directions slightly for depth
    document.querySelectorAll('.parallax-card-up').forEach(el => {
      el.style.setProperty('--scroll-offset-up', `${scrolled * -0.05}px`);
    });
    document.querySelectorAll('.parallax-card-down').forEach(el => {
      el.style.setProperty('--scroll-offset-down', `${scrolled * 0.05}px`);
    });
    
    // Hero Content Parallax
    const heroWrapper = document.getElementById('hero-content-wrapper');
    if (heroWrapper && scrolled < 1000) {
      heroWrapper.style.transform = `translateY(${scrolled * 0.4}px)`;
      heroWrapper.style.opacity = Math.max(0, 1 - scrolled / 600);
    }
  });

  // 4. Set up Scroll Reveal IntersectionObserver
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
      }
    });
  }, {
    threshold: 0.05,
    rootMargin: '0px 0px -20px 0px'
  });

  refreshRevealObservers();
}

function refreshRevealObservers() {
  if (!revealObserver) return;
  
  // Unobserve all, then observe current items
  document.querySelectorAll('.reveal').forEach(el => {
    revealObserver.observe(el);
  });
}
