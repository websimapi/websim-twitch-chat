import tmi from 'tmi.js';
import { config } from './config.js';

// --- DOM Elements ---
const channelInput = document.getElementById('channel-input');
const connectButton = document.getElementById('connect-button');
const connectionStatus = document.getElementById('connection-status');
const chatMessages = document.getElementById('chat-messages');
const userListElement = document.getElementById('user-list');
const userProfileModal = document.getElementById('user-profile-modal');
const profileUsername = document.getElementById('profile-username');
const profileChatHistory = document.getElementById('profile-chat-history');
const closeModalButton = document.querySelector('.close-button');

// --- State ---
let client = null;
let connectedChannel = null;
const users = {}; // Store user data { username: { chatHistory: [] } }

// --- LocalStorage Functions ---
const STORAGE_KEY = 'twitchChatUsers';

function loadUsersFromStorage() {
    const storedData = localStorage.getItem(STORAGE_KEY);
    if (storedData) {
        try {
            const parsedData = JSON.parse(storedData);
            Object.assign(users, parsedData);
            console.log('Loaded user data from localStorage.');
        } catch (error) {
            console.error('Error parsing user data from localStorage:', error);
            localStorage.removeItem(STORAGE_KEY); // Clear corrupted data
        }
    }
    updateUserList(); // Update UI with loaded users
}

function saveUsersToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
    } catch (error) {
        console.error('Error saving user data to localStorage:', error);
        // Handle potential storage quota exceeded errors if necessary
    }
}

// --- User Management ---
function getOrCreateUser(username) {
    if (!users[username]) {
        users[username] = { chatHistory: [] };
        console.log(`Created new user profile for: ${username}`);
        updateUserList(); // Add new user to the list
        saveUsersToStorage(); // Save immediately after creating
    }
    return users[username];
}

function addMessageToHistory(username, message) {
    const user = getOrCreateUser(username);
    user.chatHistory.push({ timestamp: new Date().toISOString(), message });
    // Limit history size
    if (user.chatHistory.length > config.maxHistoryPerUser) {
        user.chatHistory.shift(); // Remove the oldest message
    }
    saveUsersToStorage(); // Save after adding message
}

function updateUserList() {
    userListElement.innerHTML = ''; // Clear current list
    const sortedUsernames = Object.keys(users).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    sortedUsernames.forEach(username => {
        const li = document.createElement('li');
        li.textContent = username;
        li.dataset.username = username; // Store username for click handling
        li.addEventListener('click', () => openUserProfile(username));
        userListElement.appendChild(li);
    });
}

// --- UI Updates ---
function addChatMessage(username, message, tags) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');

    const userSpan = document.createElement('span');
    userSpan.classList.add('username');
    userSpan.textContent = `${username}:`;
    userSpan.style.color = tags?.color || '#6441a5'; // Use Twitch color if available
    userSpan.dataset.username = username;
    userSpan.addEventListener('click', () => openUserProfile(username));

    const messageSpan = document.createElement('span');
    messageSpan.classList.add('message-text');
    messageSpan.textContent = ` ${message}`; // Add space after username

    messageElement.appendChild(userSpan);
    messageElement.appendChild(messageSpan);
    chatMessages.appendChild(messageElement);

    // Auto-scroll to the bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Limit number of messages displayed in chat window
     while (chatMessages.children.length > config.maxMessagesInChat) {
        chatMessages.removeChild(chatMessages.firstChild);
    }
}

function updateConnectionStatus(status, channel = null) {
    connectedChannel = channel;
    let statusText = `Status: ${status}`;
    if (channel) {
        statusText += ` (Channel: ${channel})`;
    }
    connectionStatus.textContent = statusText;

    if (status === 'Connected') {
        connectButton.textContent = 'Disconnect';
        connectButton.style.backgroundColor = '#e74c3c'; // Red for disconnect
        channelInput.disabled = true;
    } else {
        connectButton.textContent = 'Connect';
        connectButton.style.backgroundColor = '#6441a5'; // Purple for connect
        channelInput.disabled = false;
        channelInput.value = ''; // Clear input on disconnect
        // Optionally clear chat on disconnect:
        // chatMessages.innerHTML = '';
        // userListElement.innerHTML = '';
    }
}

// --- User Profile Modal ---
function openUserProfile(username) {
    const user = users[username];
    if (!user) return;

    profileUsername.textContent = `Profile: ${username}`;
    profileChatHistory.innerHTML = ''; // Clear previous history

    if (user.chatHistory.length > 0) {
        user.chatHistory.forEach(entry => {
            const li = document.createElement('li');
            const timestamp = new Date(entry.timestamp).toLocaleTimeString();
            li.textContent = `[${timestamp}] ${entry.message}`;
            profileChatHistory.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = 'No chat history recorded yet.';
        profileChatHistory.appendChild(li);
    }

    userProfileModal.style.display = 'block';
}

function closeUserProfile() {
    userProfileModal.style.display = 'none';
}

// --- Twitch Connection ---
function connectToTwitch(channel) {
    if (client && client.readyState() === 'OPEN') {
        console.log('Already connected.');
        return;
    }

    if (!channel) {
        alert('Please enter a channel name.');
        return;
    }

    updateConnectionStatus('Connecting...', channel);

    client = new tmi.Client({
        options: { debug: false }, // Set to true for more logs
        connection: {
            secure: true,
            reconnect: true
        },
        channels: [channel]
    });

    client.on('message', (target, context, msg, self) => {
        if (self) return; // Ignore messages from the bot itself if logged in

        const username = context['display-name'] || context.username;
        const message = msg.trim();

        // Add message to UI
        addChatMessage(username, message, context);
        // Add message to user's history
        addMessageToHistory(username, message);
    });

    client.on('connected', (address, port) => {
        console.log(`* Connected to ${address}:${port} in channel ${channel}`);
        updateConnectionStatus('Connected', channel);
        // Clear previous chat messages on new connection
        chatMessages.innerHTML = '';
        // Note: We don't clear users or localStorage here, we persist users across connections/sessions.
        // We do update the user list display based on who is currently stored.
        updateUserList();
    });

    client.on('disconnected', (reason) => {
        console.log(`* Disconnected from Twitch: ${reason || 'Unknown reason'}`);
        updateConnectionStatus('Disconnected');
        client = null; // Ensure client is reset
    });

    client.on('join', (target, username, self) => {
        if (self) return; // Ignore self join
        console.log(`${username} joined the chat`);
        // Optionally add user to list immediately on join,
        // but current logic adds them on first message which is more robust for lurkers.
        // getOrCreateUser(username); // Uncomment if you want users added on join
    });

     client.on('part', (target, username, self) => {
        if (self) return;
         console.log(`${username} left the chat`);
         // Optionally remove user from list on part, but current logic keeps history.
         // If you want to remove them:
         // const userListItem = userListElement.querySelector(`li[data-username="${username}"]`);
         // if (userListItem) {
         //     userListItem.remove();
         // }
         // delete users[username]; // Also remove from data store if desired
         // saveUsersToStorage();
     });

    client.connect().catch(err => {
        console.error('Connection error:', err);
        updateConnectionStatus('Error connecting');
        alert(`Failed to connect: ${err}`);
        client = null; // Reset client on failed connection
    });
}

function disconnectFromTwitch() {
    if (client && client.readyState() === 'OPEN') {
        updateConnectionStatus('Disconnecting...');
        client.disconnect()
            .then(() => {
                console.log('Successfully disconnected.');
                updateConnectionStatus('Disconnected');
                client = null;
            })
            .catch(err => {
                console.error('Error during disconnection:', err);
                // Force update status even if disconnect promise fails
                updateConnectionStatus('Disconnected (error)');
                client = null; // Still reset client
            });
    } else {
        console.log('Not connected, cannot disconnect.');
         // Ensure UI reflects disconnected state if somehow out of sync
        updateConnectionStatus('Disconnected');
        client = null;
    }
}

// --- Event Listeners ---
connectButton.addEventListener('click', () => {
    if (client && client.readyState() === 'OPEN') {
        disconnectFromTwitch();
    } else {
        const channel = channelInput.value.trim() || config.defaultChannel;
        if (channel) {
            connectToTwitch(channel.toLowerCase()); // Twitch channels are lowercase
        } else {
            alert('Please enter a channel name.');
        }
    }
});

channelInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
       connectButton.click(); // Trigger connect/disconnect on Enter
    }
});

closeModalButton.addEventListener('click', closeUserProfile);

// Close modal if user clicks outside the modal content
window.addEventListener('click', (event) => {
    if (event.target === userProfileModal) {
        closeUserProfile();
    }
});

// --- Initialisation ---
loadUsersFromStorage(); // Load any persisted user data on startup
channelInput.value = config.defaultChannel; // Set default channel in input
updateConnectionStatus('Disconnected'); // Set initial status

console.log('Twitch Chat App Initialized');

