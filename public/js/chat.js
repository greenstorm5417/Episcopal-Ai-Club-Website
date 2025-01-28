// Global state variables
let isReplying = false;
let lastUserMessage = "";
let lastUserMessageElement = null;
let lastAssistantMessageElement = null;
let lastAssistantMessageFinalElement = null;
let loadingHistory = false;
let messageIndex = 0;

// Utility functions
function sanitizeHTML(str) {
    return DOMPurify.sanitize(str);
}

const customRenderer = new marked.Renderer();
customRenderer.link = function(href, title, text) {
    const sanitizedHref = href ? href : '';
    const titleAttribute = title ? `title="${title}"` : '';
    return `<a href="${sanitizedHref}" ${titleAttribute} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

function renderMarkdown(fullContent) {
    marked.setOptions({
        renderer: customRenderer,
        gfm: true,
    });
    return marked.parse(fullContent).trim();
}

function decodeWhitespace(text) {
    text = text.replace(/\\n/g, '\n');
    text = text.replace(/ \u00A0/g, '  ');
    return text;
}

function scrollToBottom() {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) {
        console.error('Messages container with id "messages" not found.');
        return;
    }

    const lastMessage = messagesContainer.lastElementChild;
    if (lastMessage) {
        setTimeout(() => {
            const chatWindow = document.getElementById('chat-window');
            const containerRect = chatWindow.getBoundingClientRect();
            const lastMessageRect = lastMessage.getBoundingClientRect();
            const bottomPadding = 200;

            const scrollPosition = lastMessageRect.bottom - containerRect.bottom + chatWindow.scrollTop + bottomPadding;
            chatWindow.scrollTo({top: scrollPosition, behavior: 'smooth' });
        }, 100);
    }
}

// State handling
function setIsReplying(value) {
    isReplying = value;
    const messageInput = document.getElementById('message');
    const submitButton = document.querySelector('.submit-button');

    if (!messageInput || !submitButton) {
        console.error('Message input or submit button not found.');
        return;
    }

    if (isReplying) {
        submitButton.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="6" y="6" width="12" height="12" fill="currentColor"/>
            </svg>
        `;
        submitButton.setAttribute('aria-label', 'Stop Response');
        hideTryAgainButton();
        hideAllEditButtons();
    } else {
        submitButton.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M4 12L20 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M16 8L20 12L16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        submitButton.setAttribute('aria-label', 'Send Message');
        if (lastAssistantMessageFinalElement && !loadingHistory) {
            showTryAgainButtonForAssistant(lastAssistantMessageFinalElement);
        }

        if (lastUserMessageElement && !loadingHistory) {
            maybeShowEditIconForNewestUserMessage();
        }
    }
}

async function stopResponse() {
    try {
        const response = await fetch('/assistant/stop_response', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
        });
        const data = await response.json();
        if (response.ok) {
            setIsReplying(false);
        } else {
            console.error('Failed to stop response:', data.error);
        }
    } catch (error) {
        console.error('Error stopping response:', error);
    }
}

function updateLastAssistantMessageFinalElement() {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;
    const assistantMessages = Array.from(messagesContainer.querySelectorAll('.message.assistant'));
    const lastCompleteAssistantMessage = assistantMessages.reverse().find(msg => msg.dataset.partial !== 'true');
    if (lastCompleteAssistantMessage) {
        lastAssistantMessageFinalElement = lastCompleteAssistantMessage;
    } else {
        lastAssistantMessageFinalElement = null;
    }
}

// Try Again / Delete / Copy message functionality
function showTryAgainButtonForAssistant(assistantMessageElement) {
    if (isReplying || loadingHistory) return;

    hideTryAgainButton();
    const wrapper = document.createElement('div');
    wrapper.classList.add('try-again-wrapper');

    const tryAgainBtn = document.createElement('button');
    tryAgainBtn.classList.add('try-again-button');
    tryAgainBtn.setAttribute('aria-label', 'Try Again');
    tryAgainBtn.setAttribute('title', 'Try Again');
    tryAgainBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 50 50" fill="currentColor">
        <path d="M 20 4 C 15.054688 4 11 8.054688 11 13 L 11 35.5625 L 5.71875 30.28125 L 4.28125 31.71875 L 11.28125 38.71875 L 12 39.40625 L 12.71875 38.71875 L 19.71875 31.71875 L 18.28125 30.28125 L 13 35.5625 L 13 13 C 13 9.144531 16.144531 6 20 6 L 31 6 L 31 4 Z M 38 10.59375 L 37.28125 11.28125 L 30.28125 18.28125 L 31.71875 19.71875 L 37 14.4375 L 37 37 C 37 40.855469 33.855469 44 30 44 L 19 44 L 19 46 L 30 46 C 34.945313 46 39 41.945313 39 37 L 39 14.4375 L 44.28125 19.71875 L 45.71875 18.28125 L 38.71875 11.28125 Z"></path>
    </svg>
    `;
    tryAgainBtn.addEventListener('click', async () => {
        await tryAgain();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.classList.add('delete-message-button');
    deleteBtn.setAttribute('aria-label', 'Delete Message');
    deleteBtn.setAttribute('title', 'Delete Message');
    deleteBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 24 24" width="24px" height="24px" fill-rule="evenodd" clip-rule="evenodd">
        <path d="M 9.5429688 1.25 C 8.5969688 1.25 7.8219219 2.0022187 7.7949219 2.9492188 C 7.7844494 3.3168038 7.7801304 3.4508084 7.7714844 3.75 L 5.5 3.75 C 5.036 3.75 4.5916719 3.9346719 4.2636719 4.2636719 C 3.9346719 4.5916719 3.75 5.036 3.75 5.5 L 3.75 8 C 3.75 8.414 4.086 8.75 4.5 8.75 L 4.8007812 8.75 C 4.8623323 9.6122246 5.3627582 16.605958 5.6191406 20.195312 C 5.7221406 21.634313 6.9183281 22.75 8.3613281 22.75 L 15.638672 22.75 C 17.081672 22.75 18.277859 21.634313 18.380859 20.195312 C 18.637242 16.605958 19.137668 9.6122246 19.199219 8.75 L 19.5 8.75 C 19.914 8.75 20.25 8.414 20.25 8 L 20.25 5.5 C 20.25 5.036 20.065328 4.5916719 19.736328 4.2636719 C 19.408328 3.9346719 18.964 3.75 18.5 3.75 L 16.228516 3.75 C 16.21987 3.4508084 16.215551 3.3168038 16.205078 2.9492188 C 16.178078 2.0022187 15.403031 1.25 14.457031 1.25 L 9.5429688 1.25 z M 9.5429688 2.75 L 14.457031 2.75 C 14.592031 2.75 14.702078 2.8571875 14.705078 2.9921875 L 14.728516 3.75 L 9.2714844 3.75 L 9.2949219 2.9921875 C 9.2979219 2.8571875 9.4079688 2.75 9.5429688 2.75 z M 5.5 5.25 L 18.5 5.25 C 18.566 5.25 18.630734 5.2752656 18.677734 5.3222656 C 18.724734 5.3692656 18.75 5.434 18.75 5.5 L 18.75 7.25 L 18.5 7.25 L 5.5 7.25 L 5.25 7.25 L 5.25 5.5 C 5.25 5.434 5.2752656 5.3692656 5.3222656 5.3222656 C 5.3692656 5.2752656 5.434 5.25 5.5 5.25 z M 6.3046875 8.75 L 17.695312 8.75 L 16.884766 20.089844 C 16.837766 20.743844 16.294672 21.25 15.638672 21.25 L 8.3613281 21.25 C 7.7053281 21.25 7.1622344 20.743844 7.1152344 20.089844 L 6.3046875 8.75 z M 8.9472656 10.751953 C 8.5342656 10.780953 8.2219531 11.140734 8.2519531 11.552734 L 8.7519531 18.552734 C 8.7809531 18.965734 9.1407344 19.278047 9.5527344 19.248047 C 9.9657344 19.219047 10.278047 18.859266 10.248047 18.447266 L 9.7480469 11.447266 C 9.7190469 11.034266 9.3592656 10.721953 8.9472656 10.751953 z M 15.052734 10.751953 C 14.640734 10.721953 14.280953 11.034266 14.251953 11.447266 L 13.751953 18.447266 C 13.721953 18.859266 14.034266 19.219047 14.447266 19.248047 C 14.859266 19.278047 15.219047 18.965734 15.248047 18.552734 L 15.748047 11.552734 C 15.778047 11.140734 15.465734 10.780953 15.052734 10.751953 z"/>
    </svg>
    `;
    deleteBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/assistant/delete_message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
                credentials: 'same-origin'
            });

            const data = await response.json();
            if (response.ok) {
                assistantMessageElement.remove();
                if (lastUserMessageElement && lastUserMessageElement.parentNode) {
                    lastUserMessageElement.remove();
                    lastUserMessageElement = null;
                    lastUserMessage = "";
                }

                updateLastAssistantMessageFinalElement();
                if (lastAssistantMessageFinalElement && !isReplying && !loadingHistory) {
                    showTryAgainButtonForAssistant(lastAssistantMessageFinalElement);
                }

            } else {
                console.error('Failed to delete message:', data.error);
            }
        } catch (error) {
            console.error('Error deleting message:', error);
        }
    });

    const copyBtn = document.createElement('button');
    copyBtn.classList.add('copy-message-button');
    copyBtn.setAttribute('aria-label', 'Copy Message');
    copyBtn.setAttribute('title', 'Copy Message');
    copyBtn.innerHTML = `
    <?xml version="1.0" ?><svg class="feather feather-copy" fill="none" height="24" stroke="currentColor" stroke-linecap="round" 
    stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" 
    xmlns="http://www.w3.org/2000/svg"><rect height="13" rx="2" ry="2" width="13" x="9" y="9"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>`;
    copyBtn.addEventListener('click', () => {
        const messageContentElem = assistantMessageElement.querySelector('.message-content');
        if (messageContentElem) {
            const textToCopy = messageContentElem.innerText;
            navigator.clipboard.writeText(textToCopy)
                .then(() => {
                    console.log('Message copied to clipboard!');
                    showStatusBanner('Message copied successfully!');
                })
                .catch(err => {
                    console.error('Failed to copy message:', err);
                    showStatusBanner('Failed to copy message.', true);
                });
        }
    });

    wrapper.appendChild(tryAgainBtn);
    wrapper.appendChild(deleteBtn);
    wrapper.appendChild(copyBtn);
    assistantMessageElement.appendChild(wrapper);
    scrollToBottom();
}

function hideTryAgainButton() {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;
    const wrappers = messagesContainer.querySelectorAll('.try-again-wrapper');
    wrappers.forEach(wrapper => wrapper.remove());
}

async function tryAgain() {
    if (isReplying) {
        await stopResponse();
        return;
    }

    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;

    if (lastAssistantMessageElement) {
        lastAssistantMessageElement.remove();
        lastAssistantMessageElement = null;
    } else {
        const assistantMessages = messagesContainer.querySelectorAll('.message.assistant');
        if (assistantMessages.length > 0) {
            assistantMessages[assistantMessages.length - 1].remove();
        }
    }

    hideTryAgainButton();
    setIsReplying(true);
    appendLoadingAssistantMessage();

    try {
        const response = await fetch('/assistant/try_again', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            appendMessage('error', `[Error]: ${errorData.error || 'Failed to try again.'}`);
            setIsReplying(false);
            return;
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;
        let buffer = '';
        
        while (!done) {
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            if (value) {
                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n\n');
                buffer = lines.pop();
        
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') {
                            done = true;
                            break;
                        }
                        updateAssistantMessagePartial(data);
                    }
                }
            }
        }
        
        setIsReplying(false);
        if (lastAssistantMessageElement) {
            lastAssistantMessageElement.dataset.partial = 'false';
            lastAssistantMessageFinalElement = lastAssistantMessageElement;
            lastAssistantMessageElement = null;
        }
        if (lastAssistantMessageFinalElement && !loadingHistory) {
            showTryAgainButtonForAssistant(lastAssistantMessageFinalElement);
        }

    } catch (error) {
        appendMessage('error', `[Error]: ${error.message}`);
        setIsReplying(false);
    }
}

// Typing animation for assistant message
function startTypingAnimation(messageElement) {
    if (messageElement.dataset.typing === 'true') return;
    messageElement.dataset.typing = 'true';

    const messageContent = messageElement.querySelector('.message-content');
    let fullContent = messageElement.dataset.fullContent || '';
    let displayedLength = parseInt(messageElement.dataset.displayedLength || '0', 10);
    const stepSize = 5;

    const spinner = messageContent.querySelector('.spinner');
    if (spinner) {
        spinner.remove();
    }

    const cursor = document.createElement('span');
    cursor.classList.add('cursor');
    cursor.textContent = '▋';

    const typeNextBatch = () => {
        fullContent = messageElement.dataset.fullContent || '';
        displayedLength = parseInt(messageElement.dataset.displayedLength || '0', 10);

        if (displayedLength >= fullContent.length) {
            const htmlContent = renderMarkdown(fullContent);
            messageContent.innerHTML = htmlContent;
            messageElement.dataset.typing = 'false';

            if (messageElement.dataset.done === 'true') {
                messageElement.dataset.partial = 'false';
            }

            scrollToBottom();
            return;
        }

        const remaining = fullContent.length - displayedLength;
        const currentStep = Math.min(stepSize, remaining);
        displayedLength += currentStep;
        messageElement.dataset.displayedLength = displayedLength;

        const partialText = fullContent.slice(0, displayedLength);
        const htmlContent = renderMarkdown(partialText);

        const notDone = (displayedLength < fullContent.length || messageElement.dataset.done !== 'true');
        
        messageContent.innerHTML = htmlContent;
        if (notDone) {
            const walker = document.createTreeWalker(
                messageContent,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let lastTextNode;
            while (walker.nextNode()) {
                lastTextNode = walker.currentNode;
            }

            if (lastTextNode) {
                const wrapper = document.createElement('span');
                wrapper.style.whiteSpace = 'pre-wrap';
                lastTextNode.parentNode.insertBefore(wrapper, lastTextNode.nextSibling);
                wrapper.appendChild(lastTextNode);
                wrapper.appendChild(cursor);
            } else {
                messageContent.appendChild(cursor);
            }
        }

        scrollToBottom();

        const lengthLeft = fullContent.length - displayedLength;
        let min_del = 1;
        let max_del = 10;
        let delay;
        
        if (lengthLeft <= 25) {
            delay = max_del;
        } else if (lengthLeft >= 250) {
            delay = min_del;
        } else {
            const t = (lengthLeft - 25) / 225;
            delay = max_del - (max_del - min_del) * (t * t);
        }
        
        delay = Math.max(Math.min(delay, max_del), min_del);
        delay = Math.max(delay, 1);

        setTimeout(typeNextBatch, delay);
    };

    typeNextBatch();
}

// Assistant message partial updates
function updateAssistantMessagePartial(chunk) {
    if (!lastAssistantMessageElement) {
        appendLoadingAssistantMessage();
    }

    const messageElement = lastAssistantMessageElement;
    const messageContent = messageElement.querySelector('.message-content');

    try {
        const jsonData = JSON.parse(chunk);

        if (jsonData.error) {
            appendMessage('error', `[Error]: ${jsonData.error}`);
            setIsReplying(false);
            return;
        }

        if (jsonData.status === 'cancelled') {
            appendMessage('system', 'Response cancelled');
            setIsReplying(false);
            return;
        }

        if (jsonData.text) {
            let fullContent = messageElement.dataset.fullContent || '';
            const decodedText = decodeWhitespace(jsonData.text);
            fullContent += decodedText;
            messageElement.dataset.fullContent = fullContent;

            if (!messageElement.dataset.displayedLength) {
                messageElement.dataset.displayedLength = '0';
            }
            startTypingAnimation(messageElement);
        }

        if (jsonData.done) {
            messageElement.dataset.done = 'true';
        }

    } catch (e) {
        if (typeof chunk === 'string' && chunk.trim()) {
            let fullContent = messageElement.dataset.fullContent || '';
            const decodedChunk = decodeWhitespace(chunk);
            fullContent += decodedChunk;
            messageElement.dataset.fullContent = fullContent;

            if (!messageElement.dataset.displayedLength) {
                messageElement.dataset.displayedLength = '0';
            }
            startTypingAnimation(messageElement);
        }
    }
}

function appendLoadingAssistantMessage() {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) {
        console.error('Messages container not found.');
        return;
    }

    const messageElement = document.createElement('div');
    messageElement.classList.add('message', 'assistant');
    messageElement.dataset.partial = 'true';
    messageElement.dataset.fullContent = '';
    messageElement.dataset.messageIndex = messageIndex++;

    const messageContent = document.createElement('div');
    messageContent.classList.add('message-content');
    messageContent.innerHTML = '<div class="spinner"></div>';
    messageElement.appendChild(messageContent);
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
    lastAssistantMessageElement = messageElement;
    return messageElement;
}

// Edit message functionality
function hideAllEditButtons() {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;
    const editButtons = messagesContainer.querySelectorAll('.edit-message-button');
    editButtons.forEach(btn => btn.remove());
}

const editIconSVG = `
    <?xml version="1.0" ?>
    <svg class="feather feather-edit" fill="none" height="24" stroke="currentColor" 
         stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
         viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
         <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
         <path d="M18.5 2.5a2 2 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
`;

function showEditIconForUserMessage(userMessageElement) {
    if (isReplying || userMessageElement.classList.contains('editing')) return;
    let editButton = userMessageElement.querySelector('.edit-message-button');
    const messageContent = userMessageElement.querySelector('.message-content');

    if (!editButton) {
        editButton = document.createElement('button');
        editButton.classList.add('edit-message-button');
        editButton.setAttribute('title', 'Edit Message');
        editButton.innerHTML = editIconSVG;
        editButton.addEventListener('click', () => {
            startEditingMessage(userMessageElement);
        });
        userMessageElement.insertBefore(editButton, messageContent);
    } else {
        editButton.style.display = 'flex';
    }
}

function maybeShowEditIconForNewestUserMessage() {
    if (isReplying || loadingHistory) return;
    if (!lastUserMessageElement) return;
    hideAllEditButtonsExcept(lastUserMessageElement);
    showEditIconForUserMessage(lastUserMessageElement);
}

function hideAllEditButtonsExcept(element) {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;
    const editButtons = messagesContainer.querySelectorAll('.edit-message-button');
    editButtons.forEach(btn => {
        if (btn.parentElement !== element) {
            btn.remove();
        }
    });
}

function startEditingMessage(userMessageElement) {
    const editButton = userMessageElement.querySelector('.edit-message-button');
    if (editButton) {
        editButton.style.display = 'none';
    }
    userMessageElement.classList.add('editing');

    const messageContent = userMessageElement.querySelector('.message-content');
    const originalText = messageContent.innerText.trim();
    userMessageElement.dataset.originalText = originalText;

    messageContent.innerHTML = '';
    const textarea = document.createElement('textarea');
    textarea.classList.add('edit-textarea');
    textarea.value = originalText;

    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    });
    textarea.dispatchEvent(new Event('input'));

    messageContent.appendChild(textarea);

    let editControls = userMessageElement.querySelector('.edit-controls');
    if (!editControls) {
        editControls = document.createElement('div');
        editControls.classList.add('edit-controls');

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => {
            cancelEditing(userMessageElement);
        });

        const sendBtn = document.createElement('button');
        sendBtn.textContent = 'Send';
        sendBtn.addEventListener('click', async () => {
            await sendEditedMessage(userMessageElement);
        });

        editControls.appendChild(cancelBtn);
        editControls.appendChild(sendBtn);
        messageContent.appendChild(editControls);
    }
}

function cancelEditing(userMessageElement) {
    userMessageElement.classList.remove('editing');
    const editControls = userMessageElement.querySelector('.edit-controls');
    const messageContent = userMessageElement.querySelector('.message-content');

    if (editControls) {
        editControls.remove();
    }

    const originalText = userMessageElement.dataset.originalText || '';
    const htmlContent = renderMarkdown(originalText);
    messageContent.innerHTML = htmlContent;

    if (!isReplying) {
        const editButton = userMessageElement.querySelector('.edit-message-button');
        if (editButton) editButton.style.display = 'flex';
    }

    delete userMessageElement.dataset.originalText;
}

async function sendEditedMessage(userMessageElement) {
    const newMessage = userMessageElement.querySelector('.edit-textarea').value.trim();
    if (!newMessage) {
        console.error('Edited message cannot be empty.');
        return;
    }

    userMessageElement.classList.remove('editing');
    delete userMessageElement.dataset.originalText;

    const editButton = userMessageElement.querySelector('.edit-message-button');
    if (editButton) editButton.style.display = 'none';

    const editControls = userMessageElement.querySelector('.edit-controls');
    if (editControls) editControls.remove();

    const textarea = userMessageElement.querySelector('.edit-textarea');
    if (textarea) textarea.remove();

    const messageContent = userMessageElement.querySelector('.message-content');
    messageContent.innerHTML = renderMarkdown(newMessage);

    const messagesContainer = document.getElementById('messages');
    const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
    const currentIndex = allMessages.indexOf(userMessageElement);
    if (currentIndex !== -1) {
        for (let i = allMessages.length - 1; i > currentIndex; i--) {
            allMessages[i].remove();
        }
    }

    setIsReplying(true);
    appendLoadingAssistantMessage();
    hideTryAgainButton();
    hideAllEditButtons();

    try {
        const response = await fetch('/assistant/edit_message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_message: newMessage }),
            credentials: 'same-origin'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            appendMessage('error', `[Error]: ${errorData.error || 'Failed to edit message.'}`);
            setIsReplying(false);
            return;
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;
        let buffer = '';
        
        while (!done) {
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            if (value) {
                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n\n');
                buffer = lines.pop();
        
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') {
                            done = true;
                            break;
                        }
                        updateAssistantMessagePartial(data);
                    }
                }
            }
        }
        
        setIsReplying(false);
        if (lastAssistantMessageElement) {
            lastAssistantMessageElement.dataset.partial = 'false';
            lastAssistantMessageFinalElement = lastAssistantMessageElement;
            lastAssistantMessageElement = null;
        }

        if (lastAssistantMessageFinalElement && !loadingHistory && !isReplying) {
            showTryAgainButtonForAssistant(lastAssistantMessageFinalElement);
        }

    } catch (error) {
        appendMessage('error', `[Error]: ${error.message}`);
        setIsReplying(false);
    }
}

// Appending messages & loading history
function appendMessage(role, text, isPartial = false) {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) {
        console.error('Messages container not found.');
        return;
    }

    const messageElement = document.createElement('div');
    messageElement.classList.add('message', role);
    messageElement.dataset.messageIndex = messageIndex++;

    if (role === 'assistant' && isPartial) {
        messageElement.dataset.partial = 'true';
        messageElement.dataset.fullContent = text;
    } else if (role === 'assistant') {
        lastAssistantMessageFinalElement = messageElement;
    } else if (role === 'user') {
        lastUserMessage = text;
        lastUserMessageElement = messageElement;
    }

    const messageContent = document.createElement('div');
    messageContent.classList.add('message-content');
    const htmlContent = renderMarkdown(text);
    messageContent.innerHTML = htmlContent;
    messageElement.appendChild(messageContent);
    messagesContainer.appendChild(messageElement);

    scrollToBottom();

    if (role === 'assistant' && !isPartial && !isReplying && !loadingHistory) {
        lastAssistantMessageFinalElement = messageElement;
        showTryAgainButtonForAssistant(messageElement);
    }

    if (role === 'user' && !isPartial && !isReplying && !loadingHistory) {
        maybeShowEditIconForNewestUserMessage();
    }

    return messageContent;
}

async function loadHistory() {
    loadingHistory = true;
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) {
        console.error('Messages container not found.');
        loadingHistory = false;
        return;
    }

    try {
        const response = await fetch('/history', {
            method: 'GET',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Failed to load history:', errorData.error || response.statusText);
            loadingHistory = false;
            return;
        }

        const data = await response.json();
        const history = data.history;

        if (Array.isArray(history)) {
            messagesContainer.innerHTML = "";
            for (const message of history) {
                if (message.role && message.content) {
                    appendMessage(message.role, message.content, false);
                    if (message.role === 'user') {
                        lastUserMessage = message.content;
                    }
                }
            }
            scrollToBottom();
        } else {
            console.warn('History data is not an array:', history);
        }
    } catch (error) {
        console.error('Error loading history:', error.message);
    }

    loadingHistory = false;
    updateLastAssistantMessageFinalElement();

    if (lastAssistantMessageFinalElement && !isReplying) {
        showTryAgainButtonForAssistant(lastAssistantMessageFinalElement);
    }
    if (lastUserMessageElement && !isReplying) {
        maybeShowEditIconForNewestUserMessage();
    }
}

// Textarea height adjustment
function adjustTextareaHeight() {
    const textarea = document.getElementById('message');
    if (!textarea) return;

    textarea.style.height = 'auto';
    const newHeight = textarea.scrollHeight;
    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight);
    const paddingTop = parseInt(getComputedStyle(textarea).paddingTop);
    const paddingBottom = parseInt(getComputedStyle(textarea).paddingBottom);
    const maxHeight = (lineHeight * 6) + paddingTop + paddingBottom;

    if (newHeight <= maxHeight) {
        textarea.style.height = `${newHeight}px`;
        textarea.style.overflowY = 'hidden';
    } else {
        textarea.style.height = `${maxHeight}px`;
        textarea.style.overflowY = 'auto';
    }
}

// Status banner
function showStatusBanner(message, isError = false) {
    const banner = document.getElementById('status-banner');
    if (!banner) {
        console.error('Status banner element not found.');
        return;
    }

    banner.textContent = message;
    banner.style.backgroundColor = isError ? '#ff6b6b' : '#28a745';
    banner.style.color = '#ffffff';
    banner.classList.remove('hidden');
    banner.classList.add('show');

    setTimeout(() => {
        banner.classList.remove('show');
        setTimeout(() => banner.classList.add('hidden'), 300); 
    }, 1000);
}

// Event listeners
document.addEventListener('DOMContentLoaded', function () {
    const messageInput = document.getElementById('message');
    if (messageInput) {
        messageInput.addEventListener('input', adjustTextareaHeight);
        adjustTextareaHeight(); 
    }
});

document.getElementById('message-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageInput = document.getElementById('message');
    if (!messageInput) {
        console.error('Message input not found.');
        return;
    }

    if (isReplying) {
        await stopResponse();
        return;
    }

    const userMessage = messageInput.value.trim();
    if (!userMessage) return;

    appendMessage('user', userMessage);
    messageInput.value = "";
    adjustTextareaHeight();
    maybeShowEditIconForNewestUserMessage();

    try {
        const sendUrl = '/assistant/send';
        setIsReplying(true);
        appendLoadingAssistantMessage();
        hideTryAgainButton();
        hideAllEditButtons();

        const response = await fetch(sendUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: userMessage }),
            credentials: 'same-origin'
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            appendMessage('error', `[Error]: ${errorText}`);
            setIsReplying(false);
            return;
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;
        let buffer = '';
        
        while (!done) {
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            if (value) {
                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n\n');
                buffer = lines.pop();
        
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') {
                            done = true;
                            break;
                        }
                        updateAssistantMessagePartial(data);
                    }
                }
            }
        }

        setIsReplying(false);
        if (lastAssistantMessageElement) {
            lastAssistantMessageElement.dataset.partial = 'false';
            lastAssistantMessageFinalElement = lastAssistantMessageElement;
            lastAssistantMessageElement = null;
        }

        if (lastAssistantMessageFinalElement && !loadingHistory && !isReplying) {
            showTryAgainButtonForAssistant(lastAssistantMessageFinalElement);
        }

    } catch (error) {
        appendMessage('error', `[Error]: ${error.message}`);
        setIsReplying(false);
    }
});

document.addEventListener('DOMContentLoaded', function () {
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer) {
        messagesContainer.innerHTML = "";
    }
    messageIndex = 0;
    loadHistory();
    adjustTextareaHeight();

    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message');

    if (messageForm && messageInput) {
        messageForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const userMessage = messageInput.value.trim();
            if (!userMessage) return;

            const sendUrl = messageForm.getAttribute('data-send-url');
            if (!sendUrl) {
                console.error('Send URL not found in data-send-url attribute.');
                return;
            }

            appendMessage('user', userMessage);
            messageInput.value = "";
            adjustTextareaHeight();

            try {
                setIsReplying(true);
                appendLoadingAssistantMessage();

                const response = await fetch(sendUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: userMessage }),
                    credentials: 'same-origin'
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    appendMessage('error', `[Error]: ${errorText}`);
                    setIsReplying(false);
                    return;
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let done = false;
                let buffer = '';

                while (!done) {
                    const { value, done: doneReading } = await reader.read();
                    done = doneReading;
                    if (value) {
                        buffer += decoder.decode(value, { stream: true });
                        let lines = buffer.split('\n\n');
                        buffer = lines.pop();

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') {
                                    done = true;
                                    break;
                                }
                                updateAssistantMessagePartial(data);
                            }
                        }
                    }
                }

                setIsReplying(false);
                if (lastAssistantMessageElement) {
                    lastAssistantMessageElement.dataset.partial = 'false';
                    lastAssistantMessageFinalElement = lastAssistantMessageElement;
                    lastAssistantMessageElement = null;
                }

                if (lastAssistantMessageFinalElement && !loadingHistory && !isReplying) {
                    showTryAgainButtonForAssistant(lastAssistantMessageFinalElement);
                }
            } catch (error) {
                appendMessage('error', `[Error]: ${error.message}`);
                setIsReplying(false);
            }
        });
    }

    const logoutButton = document.getElementById('logout');
    if (logoutButton) {
        logoutButton.addEventListener('click', function () {
            window.location.href = '/logout';
        });
    }

});

document.addEventListener('DOMContentLoaded', function () {
    const messageInput = document.getElementById('message');
    if (messageInput) {
        messageInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                if (!e.shiftKey) {
                    e.preventDefault();
                    if (!isReplying) {
                        const messageForm = document.getElementById('message-form');
                        if (messageForm) {
                            messageForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                        }
                    } else {
                        const currentValue = messageInput.value;
                        messageInput.value = currentValue + '\n';
                    }
                }
            }
        });
    }
});

// create an event listener for everytime a key is pressed while selecting the message input
document.addEventListener('DOMContentLoaded', function () {
    const messageInput = document.getElementById('message');
    // check every time a key is pressed
    messageInput.addEventListener('keydown', function (e) {
        if (messageInput.value.length >= 1000) {
            showStatusBanner('Message is too long, must be less than 1000 characters', true); 
        }
    });
});


document.addEventListener('DOMContentLoaded', function () {
    const settingsButton = document.getElementById('settings-button');
    const settingsModal = document.getElementById('settings-modal');
    const closeButton = settingsModal.querySelector('.close-button');
    const settingsForm = document.getElementById('settings-form');

    // Function to populate settings form
    const populateSettings = async () => {
        try {
            const response = await fetch('/assistant/settings', {
                method: 'GET',
                credentials: 'same-origin',
            });

            if (response.ok) {
                const data = await response.json();
                document.getElementById('class-schedules').value = data.class_schedules;
                document.getElementById('all-assignments').value = data.all_assignments;
            } else {
                const errorData = await response.json();
                showStatusBanner(`Error fetching settings: ${errorData.error || 'Unknown error'}`, true);
            }
        } catch (error) {
            showStatusBanner(`Error: ${error.message}`, true);
        }
    };

    // Function to open the modal
    const openModal = async () => {
        await populateSettings();
        settingsModal.classList.remove('hidden');
    };

    // Function to close the modal
    const closeModal = () => {
        settingsModal.classList.add('hidden');
    };

    // Event listener for opening the modal
    if (settingsButton) {
        settingsButton.addEventListener('click', openModal);
    }

    // Event listener for closing the modal when clicking the close button
    if (closeButton) {
        closeButton.addEventListener('click', closeModal);
    }

    // Event listener for closing the modal when clicking outside the modal content
    window.addEventListener('click', function (event) {
        if (event.target === settingsModal) {
            closeModal();
        }
    });

    // Event listener for closing the modal with the Escape key
    window.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
            closeModal();
        }
    });

    // Handle settings form submission
    if (settingsForm) {
        settingsForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const class_schedules = document.getElementById('class-schedules').value.trim();
            const all_assignments = document.getElementById('all-assignments').value.trim();

            if (!class_schedules || !all_assignments) {
                showStatusBanner('All settings fields are required.', true);
                return;
            }
            
            try {
                const response = await fetch('/assistant/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ class_schedules, all_assignments }),
                    credentials: 'same-origin'
                });

                const data = await response.json();
                if (response.ok) {
                    showStatusBanner('Settings updated successfully!');
                    closeModal();
                } else {
                    showStatusBanner(`Error: ${data.error || 'Failed to update settings.'}`, true);
                }
            } catch (error) {
                showStatusBanner(`Error: ${error.message}`, true);
            }
        });
    }
});
