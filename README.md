# Live Event Platform

A real-time event platform with chat functionality using Socket.IO, Express, and React.

## Quick Start

### Prerequisites
- Node.js (v14 or higher)
- npm

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd live-event-platform
   ```

2. Install server dependencies:
   ```bash
   npm install
   ```

3. Install client dependencies:
   ```bash
   cd client
   npm install
   cd ..
   ```

### Running the Application

#### Development Mode

1. Start the server:
   ```bash
   npm run dev
   ```

2. In a new terminal, start the client:
   ```bash
   cd client
   npm run dev
   ```

3. Access the application at: [http://localhost:5173](http://localhost:5173)

#### Production Mode

1. Build the client:
   ```bash
   cd client
   npm run build
   cd ..
   ```

2. Start the production server:
   ```bash
   npm start
   ```

3. Access the application at: [http://localhost:5001](http://localhost:5001)

## Features

- Real-time messaging
- Multiple event rooms
- Persistent sessions (survives page refreshes)
- Participant status updates
- System messages for join/leave events

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: React, Vite
- **State Management**: React Hooks
- **Session Management**: localStorage, UUID
