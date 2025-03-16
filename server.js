const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server and Socket.IO instance
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store events, participants, and session mappings
const events = {};
const sessions = {}; // Map session IDs to usernames and events
const userSessions = {}; // Map username+eventId to session ID

// Debug function
function debug(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  debug(`New client connected: ${socket.id}`);
  
  // Handle rejoining an event after page refresh
  socket.on('checkSession', ({ eventId, username, sessionId }) => {
    debug(`Checking session for ${username} in event ${eventId}`, { sessionId });
    
    // Check if we have a valid session for this user in this event
    const sessionKey = `${username}:${eventId}`;
    const existingSessionId = userSessions[sessionKey];
    
    if (eventId && username && events[eventId]) {
      // Create or update session
      const sessionId = existingSessionId || uuidv4();
      
      // Store session information
      sessions[sessionId] = { username, eventId, socketId: socket.id };
      userSessions[sessionKey] = sessionId;
      
      debug(`Session established: ${sessionId} for ${username} in ${eventId}`);
      
      // Send session ID back to client for storage
      socket.emit('sessionEstablished', { sessionId });
      
      // Re-join the event
      socket.eventId = eventId;
      socket.username = username;
      socket.sessionId = sessionId;
      
      // Remove any previous socket connections for this user in this event
      if (events[eventId].participants) {
        Object.keys(events[eventId].participants).forEach(participantId => {
          const participant = events[eventId].participants[participantId];
          if (participant.username === username && participantId !== socket.id) {
            debug(`Removing previous connection for ${username}: ${participantId}`);
            delete events[eventId].participants[participantId];
          }
        });
      }
      
      // Add participant to the event
      const participant = { id: socket.id, username, sessionId };
      events[eventId].participants[socket.id] = participant;
      
      // Join the socket room for this event
      socket.join(eventId);
      
      // Send event history to the participant
      socket.emit('eventHistory', {
        messages: events[eventId].messages,
        participants: Object.values(events[eventId].participants)
      });
      
      // Notify all participants about the reconnection
      const systemMessage = {
        id: Date.now(),
        sender: 'System',
        senderId: 'system',
        text: `${username} has reconnected to the event`,
        timestamp: new Date().toISOString(),
        type: 'system'
      };
      
      events[eventId].messages.push(systemMessage);
      io.to(eventId).emit('newMessage', systemMessage);
      
      // Update participant list for everyone
      io.to(eventId).emit('participantUpdate', {
        type: 'joined',
        participant: participant,
        participants: Object.values(events[eventId].participants)
      });
    } else {
      debug(`Invalid session check: event ${eventId} doesn't exist or username not provided`);
      socket.emit('sessionError', { message: 'Invalid session' });
    }
  });

  // Handle joining an event
  socket.on('joinEvent', ({ eventId, username }) => {
    debug(`${username} is joining event ${eventId}`);
    
    // Create a new session ID
    const sessionId = uuidv4();
    const sessionKey = `${username}:${eventId}`;
    
    // Store session information
    sessions[sessionId] = { username, eventId, socketId: socket.id };
    userSessions[sessionKey] = sessionId;
    
    // Send session ID back to client for storage
    socket.emit('sessionEstablished', { sessionId });
    
    // Create event if it doesn't exist
    if (!events[eventId]) {
      events[eventId] = {
        participants: {},
        messages: []
      };
    }
    
    // Add participant to the event
    socket.eventId = eventId;
    socket.username = username;
    socket.sessionId = sessionId;
    const participant = { id: socket.id, username, sessionId };
    events[eventId].participants[socket.id] = participant;
    
    // Join the socket room for this event
    socket.join(eventId);
    
    // Send event history to the new participant
    socket.emit('eventHistory', {
      messages: events[eventId].messages,
      participants: Object.values(events[eventId].participants)
    });
    
    // Add a system message about the new participant
    const systemMessage = {
      id: Date.now(),
      sender: 'System',
      senderId: 'system',
      text: `${username} has joined the event`,
      timestamp: new Date().toISOString(),
      type: 'system'
    };
    
    events[eventId].messages.push(systemMessage);
    
    // Send the system message to all participants
    io.to(eventId).emit('newMessage', systemMessage);
    
    // Notify all participants about the updated participant list
    io.to(eventId).emit('participantUpdate', {
      type: 'joined',
      participant: participant,
      participants: Object.values(events[eventId].participants)
    });
  });
  
  // Handle chat messages
  socket.on('sendMessage', (message) => {
    if (!socket.eventId) return;
    
    const eventId = socket.eventId;
    const messageData = {
      id: Date.now(),
      sender: socket.username,
      senderId: socket.id,
      text: message,
      timestamp: new Date().toISOString()
    };
    
    debug(`Message from ${socket.username} in ${eventId}: ${message.substring(0, 30)}...`);
    
    // Store the message
    events[eventId].messages.push(messageData);
    
    // Broadcast to all participants in the event
    io.to(eventId).emit('newMessage', messageData);
  });
  
  // Handle leaving an event
  socket.on('leaveEvent', () => {
    if (socket.eventId) {
      debug(`${socket.username} is leaving event ${socket.eventId}`);
      handleParticipantLeaving(socket, socket.eventId);
      
      // Remove session data
      if (socket.sessionId) {
        const sessionKey = `${socket.username}:${socket.eventId}`;
        delete sessions[socket.sessionId];
        delete userSessions[sessionKey];
      }
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    debug(`Client disconnected: ${socket.id}`);
    
    // Don't immediately remove the participant - they might be refreshing
    if (socket.eventId && events[socket.eventId] && events[socket.eventId].participants[socket.id]) {
      // Keep the session data for potential reconnection
      
      // After a timeout, if they haven't reconnected, then remove them
      setTimeout(() => {
        // Check if this socket is still registered in the event
        if (events[socket.eventId] && events[socket.eventId].participants[socket.id]) {
          debug(`Timeout reached for ${socket.id}, removing from event ${socket.eventId}`);
          handleParticipantLeaving(socket, socket.eventId);
        } else {
          debug(`Socket ${socket.id} already reconnected or properly removed`);
        }
      }, 10000); // 10 second grace period for reconnection
    }
  });
});

// Helper function to handle a participant leaving
function handleParticipantLeaving(socket, eventId) {
  if (!events[eventId] || !events[eventId].participants[socket.id]) return;
  
  const leavingParticipant = events[eventId].participants[socket.id];
  
  // Remove participant from the event
  delete events[eventId].participants[socket.id];
  
  // Add a system message about the participant leaving
  const systemMessage = {
    id: Date.now(),
    sender: 'System',
    senderId: 'system',
    text: `${leavingParticipant.username} has left the event`,
    timestamp: new Date().toISOString(),
    type: 'system'
  };
  
  if (events[eventId]) {
    events[eventId].messages.push(systemMessage);
    
    // Send the system message
    io.to(eventId).emit('newMessage', systemMessage);
    
    // Notify all remaining participants about the updated participant list
    io.to(eventId).emit('participantUpdate', {
      type: 'left',
      participant: leavingParticipant,
      participants: Object.values(events[eventId].participants)
    });
  }
  
  // Leave the socket room
  socket.leave(eventId);
  socket.eventId = null;
  socket.username = null;
  socket.sessionId = null;
  
  // Clean up empty events
  if (events[eventId] && Object.keys(events[eventId].participants).length === 0) {
    delete events[eventId];
    debug(`Event ${eventId} removed as it has no participants`);
  }
}

// API endpoint to get available events
app.get('/api/events', (req, res) => {
  const eventList = Object.keys(events).map(eventId => ({
    id: eventId,
    participantCount: Object.keys(events[eventId].participants).length
  }));
  res.json(eventList);
});

// Debug endpoint to view current state
app.get('/api/debug', (req, res) => {
  res.json({
    events: Object.keys(events).map(id => ({
      id,
      participants: Object.values(events[id].participants).map(p => ({
        id: p.id,
        username: p.username,
        sessionId: p.sessionId
      })),
      messageCount: events[id].messages.length
    })),
    sessionCount: Object.keys(sessions).length,
    userSessionCount: Object.keys(userSessions).length
  });
});

// Serve static files from the React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/dist')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist/index.html'));
  });
}

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  debug(`Server running on port ${PORT}`);
}); 