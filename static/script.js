// ==========================================
// Utility
// ==========================================
function escapeHtml(text) {
    if (text == null) return '';
    if (typeof text !== 'string') {
        try {
            text = typeof text === 'object' ? JSON.stringify(text) : String(text);
        } catch (e) {
            text = String(text);
        }
    }
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // THEME SWITCHER
    // ==========================================
    const themeButtons = document.querySelectorAll('.theme-btn');
    const savedTheme = localStorage.getItem('llm-theme') || 'chrome';

    themeButtons.forEach(btn => {
        if (btn.dataset.themeVal === savedTheme) btn.classList.add('active');
        else btn.classList.remove('active');

        btn.addEventListener('click', () => {
            themeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setTheme(btn.dataset.themeVal);
        });
    });

    function setTheme(theme) {
        document.documentElement.dataset.theme = theme;
        const bsTheme = (theme === 'light' || theme === 'chrome') ? 'light' : 'dark';
        document.documentElement.dataset.bsTheme = bsTheme;
        localStorage.setItem('llm-theme', theme);
    }

    // ==========================================
    // i18n / Language Switcher
    // ==========================================
    const langButtons = document.querySelectorAll('.lang-btn');
    let currentLang = localStorage.getItem('llm-lang') || 'en';

    function setLanguage(lang) {
        currentLang = lang;
        localStorage.setItem('llm-lang', lang);
        document.documentElement.lang = lang;

        langButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.langVal === lang);
        });

        fetch(`/static/locales/${lang}.json`)
            .then(res => res.json())
            .then(translations => {
                document.querySelectorAll('[data-i18n]').forEach(el => {
                    const key = el.dataset.i18n;
                    if (translations[key]) el.textContent = translations[key];
                });
                document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                    const key = el.dataset.i18nPlaceholder;
                    if (translations[key]) el.setAttribute('placeholder', translations[key]);
                });
            })
            .catch(err => console.error('Error loading translations:', err));
    }

    langButtons.forEach(btn => btn.addEventListener('click', () => setLanguage(btn.dataset.langVal)));
    setLanguage(currentLang);

    // ==========================================
    // AI CHAT ASSISTANT SYSTEM
    // ==========================================

    // Chat state
    let conversationHistory = [];
    let isGenerating = false;
    let currentController = null;
    let activeHistoryIndex = -1;

    // Config
    let apiUrl = localStorage.getItem('llm-api-url') || '/prompt';
    let modelName = localStorage.getItem('llm-model-name') || 'qwen2.5:7b';
    let chatHistory = JSON.parse(localStorage.getItem('llm-chat-history')) || [];

    // DOM Elements
    const chatSidebar = document.getElementById('chat-sidebar');
    const collapseSidebarBtn = document.getElementById('collapseSidebarBtn');
    const expandSidebarBtn = document.getElementById('expandSidebarBtn');
    const modelSelect = document.getElementById('modelSelect');
    const configureApiBtn = document.getElementById('configure-api-btn');
    const apiConfigModal = document.getElementById('apiConfigModal');
    const closeApiModalBtn = document.getElementById('close-api-modal-btn');
    const cancelApiModalBtn = document.getElementById('cancel-api-modal-btn');
    const saveApiConfigBtn = document.getElementById('save-api-config-btn');
    const apiUrlInput = document.getElementById('api-url-input');
    const modelNameInput = document.getElementById('model-name-input');
    const promptInput = document.getElementById('promptInput');
    const submitBtn = document.getElementById('submitBtn');
    const newChatBtn = document.getElementById('newChatBtn');
    const promptForm = document.getElementById('promptForm');
    const chatContainer = document.getElementById('chatContainer');
    const emptyState = document.getElementById('emptyState');
    const messageFeed = document.getElementById('messageFeed');

    function getModelDisplayName(name) {
        if (!name) return 'Qwen';
        if (name.toLowerCase().includes('qwen')) return 'Qwen';
        if (name.toLowerCase().includes('llama')) return 'Llama';
        if (name.toLowerCase().includes('deepseek')) return 'DeepSeek';
        if (name.toLowerCase().includes('mistral')) return 'Mistral';
        const base = name.split(':')[0];
        return base.charAt(0).toUpperCase() + base.slice(1);
    }

    function updateModelUI(name) {
        const displayName = getModelDisplayName(name);
        const emptyLogo = document.getElementById('emptyLogo');
        if (emptyLogo) {
            emptyLogo.textContent = displayName.charAt(0).toUpperCase();
        }
    }

    function syncModelSelection(selected) {
        if (!selected) return;
        modelName = selected;
        localStorage.setItem('llm-model-name', modelName);
        if (modelSelect) {
            let hasOption = false;
            for (let i = 0; i < modelSelect.options.length; i++) {
                if (modelSelect.options[i].value === modelName) {
                    hasOption = true;
                    break;
                }
            }
            if (!hasOption) {
                const opt = document.createElement('option');
                opt.value = modelName;
                opt.textContent = modelName;
                modelSelect.appendChild(opt);
            }
            modelSelect.value = modelName;
        }
        if (modelNameInput) {
            modelNameInput.value = modelName;
        }
        updateModelUI(modelName);
    }

    function loadModels() {
        fetch('/api/models')
            .then(res => res.json())
            .then(data => {
                if (!data || !data.models || data.models.length === 0) return;
                if (modelSelect) {
                    modelSelect.innerHTML = '';
                    data.models.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m;
                        opt.textContent = m;
                        modelSelect.appendChild(opt);
                    });
                }
                const saved = localStorage.getItem('llm-model-name');
                if (saved && data.models.includes(saved)) {
                    syncModelSelection(saved);
                } else if (data.default) {
                    syncModelSelection(data.default);
                } else {
                    syncModelSelection(data.models[0]);
                }
            })
            .catch(err => {
                console.error('Error fetching models:', err);
                if (modelSelect && modelSelect.value) {
                    syncModelSelection(modelSelect.value);
                }
            });
    }

    if (modelSelect) {
        modelSelect.addEventListener('change', (e) => {
            syncModelSelection(e.target.value);
        });
    }

    // Sidebar Collapsing
    collapseSidebarBtn.addEventListener('click', () => {
        chatSidebar.classList.add('collapsed');
        expandSidebarBtn.style.display = 'flex';
    });

    expandSidebarBtn.addEventListener('click', () => {
        chatSidebar.classList.remove('collapsed');
        expandSidebarBtn.style.display = 'none';
    });

    // Modal Config
    configureApiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        apiUrlInput.value = apiUrl;
        modelNameInput.value = modelName;
        apiConfigModal.classList.remove('d-none');
    });

    const closeModal = () => apiConfigModal.classList.add('d-none');
    closeApiModalBtn.addEventListener('click', closeModal);
    cancelApiModalBtn.addEventListener('click', closeModal);
    apiConfigModal.addEventListener('click', (e) => { if (e.target === apiConfigModal) closeModal(); });

    saveApiConfigBtn.addEventListener('click', () => {
        apiUrl = apiUrlInput.value.trim() || '/prompt';
        const chosenModel = modelNameInput.value.trim() || 'qwen2.5:7b';
        localStorage.setItem('llm-api-url', apiUrl);
        syncModelSelection(chosenModel);
        closeModal();
    });

    // Textarea Auto-sizing
    promptInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
        if (!isGenerating) {
            submitBtn.classList.toggle('active', this.value.trim().length > 0);
        }
    });

    // Form Events
    promptForm.addEventListener('submit', (e) => { e.preventDefault(); submitForm(); });
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isGenerating) submitForm();
        }
    });

    // New Chat
    newChatBtn.addEventListener('click', newChat);

    function newChat() {
        if (isGenerating && currentController) currentController.abort();
        activeHistoryIndex = -1;
        conversationHistory = [];
        messageFeed.innerHTML = '';
        emptyState.style.display = 'flex';
        promptInput.value = '';
        promptInput.style.height = 'auto';
        resetButtonState();
        document.getElementById('currentChatTab').querySelector('span').setAttribute('data-i18n', 'chat_current');
        // Re-apply current translation
        setLanguage(currentLang);
        document.querySelectorAll('.chat-sidebar-item').forEach(i => i.classList.remove('active-chat-item'));
        document.getElementById('currentChatTab').classList.add('active-chat-item');
    }

    // History
    function saveHistory() {
        localStorage.setItem('llm-chat-history', JSON.stringify(chatHistory));
        renderHistoryList();
    }

    function renderHistoryList() {
        const chatHistoryList = document.getElementById('chatHistoryList');
        const currentTab = document.getElementById('currentChatTab');
        chatHistoryList.innerHTML = '';
        chatHistoryList.appendChild(currentTab);

        chatHistory.forEach((chat, idx) => {
            const item = document.createElement('div');
            item.className = 'chat-sidebar-item px-2 py-2 rounded d-flex align-items-center justify-content-between';
            if (idx === activeHistoryIndex) item.classList.add('active-chat-item');
            item.innerHTML = `
                <div class="d-flex align-items-center overflow-hidden flex-grow-1" style="font-size: 0.85rem;">
                    <i class="bi bi-chat-left-text me-2 flex-shrink-0"></i>
                    <span class="text-truncate">${escapeHtml(chat.title)}</span>
                </div>
                <button class="btn btn-sm p-0 text-muted hover-delete-btn" style="background: transparent; border: none; opacity: 0.6;" data-idx="${idx}">
                    <i class="bi bi-trash-fill small"></i>
                </button>
            `;

            const delBtn = item.querySelector('.hover-delete-btn');
            delBtn.addEventListener('mouseenter', () => delBtn.style.opacity = '1');
            delBtn.addEventListener('mouseleave', () => delBtn.style.opacity = '0.6');

            item.addEventListener('click', (e) => {
                if (e.target.closest('.hover-delete-btn')) {
                    e.stopPropagation();
                    const deleteIdx = Number.parseInt(e.target.closest('.hover-delete-btn').dataset.idx, 10);
                    chatHistory.splice(deleteIdx, 1);
                    saveHistory();
                    if (deleteIdx === activeHistoryIndex) newChat();
                    else if (deleteIdx < activeHistoryIndex) activeHistoryIndex--;
                    return;
                }
                loadConversation(idx);
            });

            chatHistoryList.appendChild(item);
        });
    }

    function loadConversation(idx) {
        if (isGenerating && currentController) currentController.abort();
        activeHistoryIndex = idx;
        const chat = chatHistory[idx];
        conversationHistory = [...chat.messages];
        renderConversation();
        document.querySelectorAll('.chat-sidebar-item').forEach(i => i.classList.remove('active-chat-item'));
        const items = document.querySelectorAll('.chat-sidebar-item');
        if (items[idx + 1]) items[idx + 1].classList.add('active-chat-item');
    }

    function renderConversation() {
        messageFeed.innerHTML = '';
        if (conversationHistory.length === 0) {
            emptyState.style.display = 'flex';
            return;
        }
        emptyState.style.display = 'none';
        conversationHistory.forEach(msg => {
            if (msg.role === 'user') addUserMessage(msg.content);
            else addAssistantMessage(marked.parse(msg.content));
        });
        scrollToBottom();
    }

    // Button states
    function setButtonToStopState() {
        submitBtn.innerHTML = '<i class="bi bi-stop-fill" style="font-size:1.15rem; line-height:1;"></i>';
        submitBtn.className = 'send-btn btn rounded-circle p-1 d-flex align-items-center justify-content-center stop-btn active';
    }

    function resetButtonState() {
        submitBtn.innerHTML = '<i class="bi bi-arrow-up-short" style="font-size: 1.35rem; line-height: 1;"></i>';
        submitBtn.className = 'send-btn btn rounded-circle p-1 d-flex align-items-center justify-content-center';
        submitBtn.classList.toggle('active', promptInput.value.trim().length > 0);
    }

    // UI Message helpers
    function addUserMessage(message) {
        messageFeed.insertAdjacentHTML('beforeend', `
            <div class="message-wrapper user">
                <div class="message-content">
                    <span class="sender-name">You</span>
                    <div class="message-bubble">${escapeHtml(message)}</div>
                </div>
            </div>
        `);
    }

    function addAssistantMessage(htmlContent) {
        const displayName = getModelDisplayName(modelName);
        const initial = displayName.charAt(0).toUpperCase();
        messageFeed.insertAdjacentHTML('beforeend', `
            <div class="message-wrapper assistant">
                <div class="avatar-circle qwen-avatar flex-shrink-0">${initial}</div>
                <div class="message-content flex-grow-1">
                    <span class="sender-name">${escapeHtml(displayName)}</span>
                    <div class="message-bubble">${htmlContent}</div>
                </div>
            </div>
        `);
        messageFeed.querySelectorAll('.message-wrapper:last-child pre code').forEach(block => {
            if (typeof hljs !== 'undefined') hljs.highlightElement(block);
        });
    }

    function showLoadingIndicator() {
        const id = 'loading_' + Date.now();
        const displayName = getModelDisplayName(modelName);
        const initial = displayName.charAt(0).toUpperCase();
        messageFeed.insertAdjacentHTML('beforeend', `
            <div class="message-wrapper assistant" id="${id}">
                <div class="avatar-circle qwen-avatar flex-shrink-0">${initial}</div>
                <div class="message-content flex-grow-1">
                    <span class="sender-name">${escapeHtml(displayName)}</span>
                    <ul class="states-list list-unstyled ms-2 mb-2" id="${id}_states" style="font-size: 0.9em; color: var(--text-muted);"></ul>
                    <div class="typing-indicator" id="${id}_dots">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                    <div class="message-bubble" id="${id}_bubble" style="display:none;"></div>
                </div>
            </div>
        `);
        return id;
    }

    function scrollToBottom() {
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    }

    function saveCurrentConversationToHistory(prompt) {
        if (activeHistoryIndex === -1) {
            const newChatObj = {
                title: prompt.length > 25 ? prompt.substring(0, 25) + '...' : prompt,
                messages: [...conversationHistory]
            };
            chatHistory.unshift(newChatObj);
            activeHistoryIndex = 0;
        } else {
            chatHistory[activeHistoryIndex].messages = [...conversationHistory];
        }
        saveHistory();
    }

    // Core submit
    function submitForm() {
        if (isGenerating) {
            if (currentController) currentController.abort();
            return;
        }

        const prompt = promptInput.value.trim();
        if (!prompt) return;

        promptInput.value = '';
        promptInput.style.height = 'auto';
        submitBtn.classList.remove('active');
        emptyState.style.display = 'none';

        addUserMessage(prompt);
        conversationHistory.push({ role: 'user', content: prompt });

        const loadingId = showLoadingIndicator();
        scrollToBottom();

        isGenerating = true;
        currentController = new AbortController();
        promptForm.setAttribute('novalidate', 'novalidate');
        setButtonToStopState();

        let assistantMessageId = null;
        let assistantText = '';

        fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: conversationHistory, model: modelName }),
            signal: currentController.signal
        })
        .then(response => {
            if (!response.ok) throw new Error('Server connection error');
            const dotsEl = document.getElementById(loadingId + '_dots');
            const bubbleEl = document.getElementById(loadingId + '_bubble');
            assistantMessageId = loadingId;
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let responseStarted = false;

            function readChunk() {
                return reader.read().then(({ done, value }) => {
                    if (done) {
                        conversationHistory.push({ role: 'assistant', content: assistantText });
                        saveCurrentConversationToHistory(prompt);
                        const currentTab = document.getElementById('currentChatTab');
                        if (currentTab) {
                            const span = currentTab.querySelector('span');
                            if (span) span.textContent = prompt.length > 20 ? prompt.substring(0, 20) + '...' : prompt;
                        }
                        return;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine) continue;
                        try {
                            const data = JSON.parse(trimmedLine);
                            if (data.error) {
                                if (!responseStarted) {
                                    dotsEl && (dotsEl.style.display = 'none');
                                    bubbleEl && (bubbleEl.style.display = '');
                                    responseStarted = true;
                                }
                                const errorText = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
                                bubbleEl && bubbleEl.insertAdjacentHTML('beforeend', `<p class="error-msg">${escapeHtml(errorText)}</p>`);
                            } else if (data.state) {
                                const statesEl = document.getElementById(assistantMessageId + '_states');
                                if (statesEl) {
                                    statesEl.insertAdjacentHTML('beforeend', `<li><i class="bi bi-check2-circle me-1 text-success"></i> ${escapeHtml(data.state)}</li>`);
                                }
                            } else {
                                const content = data.message?.content || data.response;
                                if (content) {
                                    assistantText += typeof content === 'string' ? content : JSON.stringify(content);
                                    if (!responseStarted) {
                                        responseStarted = true;
                                        dotsEl && (dotsEl.style.display = 'none');
                                        if (bubbleEl) {
                                            bubbleEl.style.display = '';
                                        }
                                    }
                                    if (bubbleEl) {
                                        bubbleEl.innerHTML = marked.parse(assistantText);
                                        bubbleEl.querySelectorAll('pre code').forEach(block => {
                                            if (typeof hljs !== 'undefined') hljs.highlightElement(block);
                                        });
                                    }
                                }
                            }
                        } catch (err) {
                            console.error('Error parsing stream line:', err);
                        }
                    }

                    scrollToBottom();
                    return readChunk();
                });
            }

            return readChunk();
        })
        .catch(error => {
            document.getElementById(loadingId)?.remove();

            if (error.name === 'AbortError') {
                if (assistantText) {
                    conversationHistory.push({ role: 'assistant', content: assistantText });
                    saveCurrentConversationToHistory(prompt);
                    const bubbleEl = document.querySelector(`#${assistantMessageId} .message-bubble`);
                    if (bubbleEl) {
                        bubbleEl.insertAdjacentHTML('beforeend', '<div class="generation-stopped-badge"><i class="bi bi-exclamation-octagon me-1"></i>Stopped</div>');
                    }
                } else if (assistantMessageId) {
                    document.getElementById(assistantMessageId)?.remove();
                }
            } else if (assistantMessageId) {
                const bubbleEl = document.querySelector(`#${assistantMessageId} .message-bubble`);
                if (bubbleEl) {
                    bubbleEl.style.display = '';
                    bubbleEl.insertAdjacentHTML('beforeend', `<p class="error-msg">Error: ${error.message || 'Unknown error'}</p>`);
                }
            } else {
                addAssistantMessage(`<p class="error-msg">Error: ${error.message || 'Unknown error'}</p>`);
            }
            scrollToBottom();
        })
        .finally(() => {
            isGenerating = false;
            currentController = null;
            promptForm.removeAttribute('novalidate');
            resetButtonState();
        });
    }

    // Init
    loadModels();
    syncModelSelection(modelName);
    renderHistoryList();
});
