import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

// Use environment variable for the endpoint with a fallback
const ENDPOINT = import.meta.env.VITE_SERVER_URL || 'http://localhost:5001';

// Debug function
function debug(message, data = null) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

function App() {
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [eventId, setEventId] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [activeEvent, setActiveEvent] = useState(null);
  const [availableEvents, setAvailableEvents] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  
  const socketRef = useRef();
  const messagesEndRef = useRef(null);
  
  // Load session data from localStorage on initial render
  useEffect(() => {
    const savedUsername = localStorage.getItem('username');
    const savedEventId = localStorage.getItem('eventId');
    const savedSessionId = localStorage.getItem('sessionId');
    
    debug('Loading saved session data', { savedUsername, savedEventId, savedSessionId });
    
    if (savedUsername) setUsername(savedUsername);
    if (savedEventId) {
      setEventId(savedEventId);
      setActiveEvent(savedEventId);
    }
    if (savedSessionId) setSessionId(savedSessionId);
  }, []);
  
  // Initialize socket connection
  useEffect(() => {
    debug('Initializing socket connection');
    
    socketRef.current = io(ENDPOINT);
    
    socketRef.current.on('connect', () => {
      debug(`Connected to server with ID: ${socketRef.current.id}`);
      setConnected(true);
      
      // Check if we need to rejoin an event after page refresh
      const savedUsername = localStorage.getItem('username');
      const savedEventId = localStorage.getItem('eventId');
      const savedSessionId = localStorage.getItem('sessionId');
      
      if (savedUsername && savedEventId) {
        debug(`Attempting to rejoin event ${savedEventId} as ${savedUsername}`, { sessionId: savedSessionId });
        socketRef.current.emit('checkSession', { 
          eventId: savedEventId, 
          username: savedUsername,
          sessionId: savedSessionId
        });
      }
    });
    
    socketRef.current.on('disconnect', () => {
      debug('Disconnected from server');
      setConnected(false);
    });
    
    socketRef.current.on('sessionEstablished', ({ sessionId }) => {
      debug(`Session established: ${sessionId}`);
      setSessionId(sessionId);
      localStorage.setItem('sessionId', sessionId);
    });
    
    socketRef.current.on('sessionError', ({ message }) => {
      debug(`Session error: ${message}`);
      // Clear session data if there's an error
      localStorage.removeItem('eventId');
      localStorage.removeItem('sessionId');
      setActiveEvent(null);
      addNotification(`Session error: ${message}`);
    });
    
    return () => {
      debug('Cleaning up socket connection');
      socketRef.current.disconnect();
    };
  }, []);
  
  // Set up event listeners when connected
  useEffect(() => {
    if (connected && socketRef.current) {
      debug('Setting up event listeners');
      
      // Fetch available events when connected
      fetchEvents();
      
      // Event history received when joining an event
      socketRef.current.on('eventHistory', (data) => {
        debug('Received event history', { 
          messageCount: data.messages.length, 
          participantCount: data.participants.length 
        });
        setMessages(data.messages);
        setParticipants(data.participants);
        
        // Auto-scroll to bottom when loading history
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      });
      
      // New message received
      socketRef.current.on('newMessage', (message) => {
        debug(`New message from ${message.sender}: ${message.text.substring(0, 30)}...`);
        setMessages((prevMessages) => [...prevMessages, message]);
        
        // Auto-scroll to bottom when new message arrives
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      });
      
      // Participant updates (joined/left)
      socketRef.current.on('participantUpdate', (data) => {
        debug(`Participant update: ${data.participant.username} ${data.type}`, {
          participantCount: data.participants.length
        });
        setParticipants(data.participants);
        
        // Add a notification for the participant update
        const action = data.type === 'joined' ? 'joined' : 'left';
        addNotification(`${data.participant.username} has ${action} the event`);
      });
      
      return () => {
        debug('Removing event listeners');
        socketRef.current.off('eventHistory');
        socketRef.current.off('newMessage');
        socketRef.current.off('participantUpdate');
        socketRef.current.off('sessionEstablished');
        socketRef.current.off('sessionError');
      };
    }
  }, [connected]);
  
  // Fetch available events
  const fetchEvents = async () => {
    try {
      debug('Fetching available events');
      const response = await fetch(`${ENDPOINT}/api/events`);
      const data = await response.json();
      setAvailableEvents(data);
      debug(`Found ${data.length} available events`);
    } catch (error) {
      console.error('Error fetching events:', error);
    }
  };
  
  // Join an event
  const joinEvent = (e) => {
    e.preventDefault();
    if (!username || !eventId) return;
    
    debug(`Joining event ${eventId} as ${username}`);
    
    // Save session data to localStorage
    localStorage.setItem('username', username);
    localStorage.setItem('eventId', eventId);
    
    socketRef.current.emit('joinEvent', { eventId, username });
    setActiveEvent(eventId);
  };
  
  // Leave the current event
  const leaveEvent = () => {
    debug(`Leaving event ${activeEvent}`);
    socketRef.current.emit('leaveEvent');
    setActiveEvent(null);
    setMessages([]);
    setParticipants([]);
    
    // Clear session data
    localStorage.removeItem('username');
    localStorage.removeItem('eventId');
    localStorage.removeItem('sessionId');
    setSessionId(null);
    
    fetchEvents();
  };
  
  // Send a message
  const sendMessage = (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    
    debug(`Sending message: ${message.substring(0, 30)}...`);
    socketRef.current.emit('sendMessage', message);
    setMessage('');
  };
  
  // Add a notification
  const addNotification = (text) => {
    const notification = {
      id: Date.now(),
      text,
      timestamp: new Date()
    };
    
    setNotifications(prev => [...prev, notification]);
    
    // Remove notification after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 5000);
  };
  
  return (
    <div className="App">
      <header>
        <h1>Live Event Platform</h1>
        <div className="connection-status">
          Status: 
          <span className={`status ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          {sessionId && <span className="session-info"> (Session: {sessionId.substring(0, 8)}...)</span>}
        </div>
      </header>
      
      <main>
        {/* Notifications */}
        <div className="notifications">
          {notifications.map(notification => (
            <div key={notification.id} className="notification">
              {notification.text}
            </div>
          ))}
        </div>
        
        {!activeEvent ? (
          <div className="join-container">
            <h2>Join an Event</h2>
            
            <form onSubmit={joinEvent} className="join-form">
              <div className="form-group">
                <label htmlFor="username">Your Name</label>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your name"
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="eventId">Event ID</label>
                <input
                  type="text"
                  id="eventId"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  placeholder="Enter event ID or create a new one"
                  required
                />
              </div>
              
              <button type="submit">Join Event</button>
            </form>
            
            {availableEvents.length > 0 && (
              <div className="available-events">
                <h3>Available Events</h3>
                <ul>
                  {availableEvents.map(event => (
                    <li key={event.id}>
                      <button
                        onClick={() => setEventId(event.id)}
                        className="event-button"
                      >
                        {event.id} ({event.participantCount} participants)
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="event-room">
            <div className="event-header">
              <h2>Event: {activeEvent}</h2>
              <button onClick={leaveEvent} className="leave-button">Leave Event</button>
            </div>
            
            <div className="event-content">
              <div className="participants-panel">
                <h3>Participants ({participants.length})</h3>
                <ul>
                  {participants.map((participant) => (
                    <li key={participant.id} className="participant">
                      {participant.username}
                      {participant.id === socketRef.current?.id && " (You)"}
                    </li>
                  ))}
                </ul>
              </div>
              
              <div className="chat-panel">
                <div className="messages">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`message ${
                        msg.type === 'system' 
                          ? 'system' 
                          : msg.senderId === socketRef.current?.id 
                            ? "own" 
                            : "other"
                      }`}
                    >
                      <div className="message-header">
                        <span className="sender">{msg.sender}</span>
                        <span className="timestamp">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="message-body">{msg.text}</div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
                
                <form onSubmit={sendMessage} className="message-form">
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type a message..."
                  />
                  <button type="submit">Send</button>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
