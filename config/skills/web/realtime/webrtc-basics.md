---
name: webrtc-basics
description: WebRTC fundamentals for peer-to-peer audio, video, and data channels
trigger_patterns:
  - "webrtc"
  - "peer to peer"
  - "video call"
  - "data channel"
  - "p2p"
capabilities:
  - web
version: "1.0.0"
---
# WebRTC Basics

## Overview
WebRTC enables peer-to-peer communication directly between browsers for audio, video, and arbitrary data without plugins.

## Connection Flow
1. **Create offer**: initiator creates an RTCPeerConnection and generates an SDP offer
2. **Signal offer**: send offer to remote peer via signaling server (WebSocket, HTTP)
3. **Create answer**: remote peer sets the offer and generates an SDP answer
4. **Signal answer**: send answer back to initiator
5. **ICE candidates**: exchange network candidates for NAT traversal
6. **Connected**: direct peer-to-peer connection established

## Peer Connection
```typescript
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:turn.example.com', username: 'user', credential: 'pass' },
  ],
});

// Handle ICE candidates
pc.onicecandidate = (event) => {
  if (event.candidate) {
    signalingServer.send({ type: 'ice-candidate', candidate: event.candidate });
  }
};

// Receive remote stream
pc.ontrack = (event) => {
  remoteVideo.srcObject = event.streams[0];
};
```

## Media Streams
```typescript
// Get local camera and microphone
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: 1280, height: 720 },
  audio: true,
});

// Add tracks to peer connection
stream.getTracks().forEach(track => pc.addTrack(track, stream));
```

## Data Channels
```typescript
const channel = pc.createDataChannel('chat', { ordered: true });

channel.onopen = () => channel.send('Hello peer!');
channel.onmessage = (event) => console.log('Received:', event.data);

// Remote peer receives the channel
pc.ondatachannel = (event) => {
  const remoteChannel = event.channel;
  remoteChannel.onmessage = (msg) => console.log(msg.data);
};
```

## Signaling Server
- WebRTC does not define how to exchange SDP and ICE candidates
- Use WebSocket, HTTP polling, or any messaging channel as signaling
- The signaling server only relays metadata — media flows peer-to-peer

## NAT Traversal
- **STUN**: discovers public IP and port (works for most NATs)
- **TURN**: relays traffic when direct connection fails (fallback)
- Always configure both STUN and TURN servers for reliability

## Best Practices
- Always provide TURN servers as fallback (10-20% of connections need them)
- Handle connection state changes (disconnected, failed, closed)
- Implement graceful reconnection logic
- Limit video resolution and bitrate based on network conditions
- Test with restrictive network conditions (symmetric NAT, firewalls)
