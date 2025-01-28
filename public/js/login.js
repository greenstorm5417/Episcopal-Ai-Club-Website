// Function to parse query parameters from the URL
function getQueryParams() {
    const params = {};
    window.location.search.substring(1).split("&").forEach(function(pair) {
        if (pair) {
            const [key, value] = pair.split("=");
            params[decodeURIComponent(key)] = decodeURIComponent(value || '');
        }
    });
    return params;
}

// Function to display messages and errors based on query parameters
window.onload = function() {
    const params = getQueryParams();
    const messageContainer = document.getElementById('message-container');

    if (params.message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'redirect-message';
        messageElement.innerHTML = `<p class="redirect-text">${params.message}</p>`;
        messageContainer.appendChild(messageElement);
    }

    if (params.error) {
        const errorElement = document.createElement('p');
        errorElement.className = 'error';
        errorElement.textContent = params.error;
        messageContainer.appendChild(errorElement);
    }
}
