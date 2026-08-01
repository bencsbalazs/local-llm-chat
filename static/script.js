function escapeHtml(text) {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

$(document).ready(function () {
    // Keep track of the active message history
    let conversationHistory = [];

    // Initialize Lucide icons
    lucide.createIcons();

    // Toggle Sidebar functionality
    $('#collapseSidebarBtn').on('click', function () {
        $('#sidebar').addClass('collapsed');
        $('#expandSidebarBtn').show();
    });

    // Show Sidebar functionality
    $('#expandSidebarBtn').on('click', function () {
        $('#sidebar').removeClass('collapsed');
        $('#expandSidebarBtn').hide();
    });

    // Handle Textarea Auto-resize and Send Button styling
    const promptInput = $('#promptInput');
    const submitBtn = $('#submitBtn');

    promptInput.on('input', function () {
        // Auto-resize
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';

        // Toggle active state of send button
        if (this.value.trim().length > 0) {
            submitBtn.addClass('active');
        } else {
            submitBtn.removeClass('active');
        }
    });

    // Handle suggestions click
    $('.suggestion-card').on('click', function () {
        const prompt = $(this).attr('data-prompt');
        promptInput.val(prompt);
        promptInput.trigger('input'); // Resize & activate button
        submitForm();
    });

    // Start New Chat
    $('#newChatBtn').on('click', function () {
        conversationHistory = [];
        $('#messageFeed').empty();
        $('#emptyState').show();
        promptInput.val('');
        promptInput.trigger('input');
        $('#currentChatTab').html('<i data-lucide="message-square" style="width: 16px; height: 16px;"></i> Current Conversation');
        lucide.createIcons();
    });

    // Handle form submit
    $('#promptForm').on('submit', function (event) {
        event.preventDefault();
        submitForm();
    });

    // Handle Enter to submit (Shift+Enter for new line)
    promptInput.on('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitForm();
        }
    });

    function submitForm() {
        const prompt = promptInput.val().trim();
        if (!prompt) return;

        // Reset input immediately
        promptInput.val('');
        promptInput.css('height', 'auto');
        submitBtn.removeClass('active');

        // Hide empty state if visible
        $('#emptyState').hide();

        // 1. Add User Message to UI
        addUserMessage(prompt);

        // 2. Add message to array history
        conversationHistory.push({ role: 'user', content: prompt });

        // 3. Show Loading Indicator
        const loadingId = showLoadingIndicator();

        // Scroll to bottom
        scrollToBottom();

        // 4. Send API Request to Flask backend with streaming fetch
        fetch('/prompt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ messages: conversationHistory })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            
            // Remove loading indicator
            $(`#${loadingId}`).remove();

            // Create Assistant Message container in UI
            const assistantMessageId = addAssistantPlaceholder();
            const bubbleElement = $(`#${assistantMessageId} .message-bubble`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let assistantText = '';
            let buffer = '';

            function readChunk() {
                return reader.read().then(({ done, value }) => {
                    if (done) {
                        // Complete assistant response history entry
                        conversationHistory.push({ role: 'assistant', content: assistantText });

                        // Update sidebar active chat preview with the first user prompt if it was a new chat
                        if (conversationHistory.length === 2) {
                            const previewText = prompt.length > 20 ? prompt.substring(0, 20) + '...' : prompt;
                            $('#currentChatTab').html(`<i data-lucide="message-square" style="width: 16px; height: 16px;"></i> ${previewText}`);
                            lucide.createIcons();
                        }
                        return;
                    }

                    // Decode chunk and add to buffer
                    buffer += decoder.decode(value, { stream: true });

                    // Parse line-delimited JSON chunks
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep the last partial line in buffer

                    for (const line of lines) {
                        if (line.trim() === '') continue;
                        try {
                            const data = JSON.parse(line);
                            if (data.error) {
                                bubbleElement.append(`<p class="error-msg">${escapeHtml(data.error)}</p>`);
                            } else if (data.message && data.message.content) {
                                assistantText += data.message.content;

                                // Render markdown on the fly
                                const html = marked.parse(assistantText);
                                bubbleElement.html(html);

                                // Syntax highlight code blocks in this bubble
                                bubbleElement.find('pre code').each(function (i, block) {
                                    hljs.highlightElement(block);
                                });
                            }
                        } catch (e) {
                            console.error('Error parsing line:', e);
                        }
                    }

                    scrollToBottom();
                    return readChunk();
                });
            }

            return readChunk();
        })
        .catch(error => {
            $(`#${loadingId}`).remove();
            addAssistantMessage(`<p class="error-msg">Error: ${error.message || 'Unknown error'}</p>`);
            scrollToBottom();
        });
    }

    function addUserMessage(message) {
        const html = `
            <div class="message-wrapper user">
                <div class="message-content">
                    <span class="sender-name">You</span>
                    <div class="message-bubble">${escapeHtml(message)}</div>
                </div>
            </div>
        `;
        $('#messageFeed').append(html);
    }

    function addAssistantMessage(htmlContent) {
        const html = `
            <div class="message-wrapper assistant">
                <div class="avatar-circle qwen-avatar">Q</div>
                <div class="message-content">
                    <span class="sender-name">Qwen</span>
                    <div class="message-bubble">${htmlContent}</div>
                </div>
            </div>
        `;
        $('#messageFeed').append(html);
        
        // Apply code syntax highlighting
        hljs.highlightAll();
    }

    function addAssistantPlaceholder() {
        const id = 'assistant_' + Date.now();
        const html = `
            <div class="message-wrapper assistant" id="${id}">
                <div class="avatar-circle qwen-avatar">Q</div>
                <div class="message-content">
                    <span class="sender-name">Qwen</span>
                    <div class="message-bubble"></div>
                </div>
            </div>
        `;
        $('#messageFeed').append(html);
        return id;
    }

    function showLoadingIndicator() {
        const id = 'loading_' + Date.now();
        const html = `
            <div class="message-wrapper assistant" id="${id}">
                <div class="avatar-circle qwen-avatar">Q</div>
                <div class="message-content">
                    <span class="sender-name">Qwen</span>
                    <div class="typing-indicator">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                </div>
            </div>
        `;
        $('#messageFeed').append(html);
        return id;
    }

    function scrollToBottom() {
        const container = $('#chatContainer');
        container.animate({ scrollTop: container[0].scrollHeight }, 200);
    }
});