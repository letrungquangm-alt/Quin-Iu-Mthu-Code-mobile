---
name: rocketchat-comms
description: >-
  Comprehensive communication skill for Rocket.Chat: building real-time chat UIs,
  voice notes & audio messaging, WebRTC voice/video calling interfaces, Jitsi integration,
  REST & Realtime DDP APIs, Embedded Chat, and live chat omnichannel workflows.
  Activate when the user asks to integrate, build, or customize chat messaging, voice chat,
  audio players, or video call features based on Rocket.Chat.
version: 1.0.0
---

# Rocket.Chat Communications & Voice/Video Calling Skill

This skill guides the design, integration, and development of real-time messaging, voice notes, and audio/video calling interfaces powered by Rocket.Chat APIs and WebRTC.

---

## 1. Core Architecture Overview

Rocket.Chat provides an enterprise-grade communications backbone:
- **Backend / Engine**: Node.js, Meteor, MongoDB, microservices architecture.
- **Protocols**: REST API (`/api/v1/*`), Realtime DDP / WebSocket, WebRTC signaling.
- **Frontend / Design System**: `@rocket.chat/fuselage` (React Design System), `@rocket.chat/ui-kit`.
- **Calling**: Native WebRTC, Jitsi Meet (`video-conference` API), BigBlueButton.
- **Voice Notes**: In-browser MediaRecorder API (`audio/webm;codecs=opus`), uploaded as file attachments with duration metadata and playable audio waveforms.

---

## 2. Audio & Voice Messaging UI

### Recording & Sending Voice Notes
To implement a Telegram/WhatsApp-style voice message button:
1. Use `navigator.mediaDevices.getUserMedia({ audio: true })`.
2. Capture chunks via `MediaRecorder` in `audio/webm` or `audio/ogg`.
3. Post to `/api/v1/rooms.upload/:roomId` with `msgType: 'voice'`.

```javascript
// Example: Voice Note Recorder
async function recordVoiceNote(durationLimitMs = 60000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  const chunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(chunks, { type: 'audio/webm' });
      stream.getTracks().forEach(track => track.stop());
      resolve(audioBlob);
    };

    mediaRecorder.start();
    // Stop recording after durationLimitMs or on user action
  });
}
```

### Voice Player Component with Waveform
- Render audio with play/pause toggle, current playback time, total duration, and scrubbable progress bar.
- Format:
```html
<div class="rc-voice-bubble">
  <button class="rc-voice-play-btn" aria-label="Play voice note">▶</button>
  <div class="rc-voice-waveform">
    <div class="rc-voice-progress" style="width: 45%;"></div>
  </div>
  <span class="rc-voice-duration">0:24 / 0:58</span>
</div>
```

---

## 3. WebRTC Voice & Video Calling UI

Rocket.Chat coordinates 1-on-1 and group calls through its Video Conference subsystem:

### Call Lifecycle
1. **Initiate Call**: `POST /api/v1/video-conference/start` with `{ roomId, title }`.
2. **Signal Call State**: Notify participants via WebSocket event `video-conference.call`.
3. **In-Call Overlay / Floating Modal**:
   - Audio input/output selector (mic/speaker)
   - Video feed with local PIP (Picture-in-Picture)
   - Controls: Mute Mic, Toggle Camera, Share Screen, End Call (`call-end`)
   - Call duration stopwatch (`00:05:42`)

```javascript
// Starting a Video/Audio Conference in a Room
async function startCall(serverUrl, authToken, userId, roomId, isAudioOnly = false) {
  const res = await fetch(`${serverUrl}/api/v1/video-conference/start`, {
    method: 'POST',
    headers: {
      'X-Auth-Token': authToken,
      'X-User-Id': userId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      roomId,
      title: isAudioOnly ? 'Cuộc gọi thoại' : 'Cuộc gọi video',
      allowRinging: true
    })
  });
  const data = await res.json();
  if (data.success && data.data?.url) {
    // data.data.url contains the direct conference room URL (e.g. Jitsi / WebRTC frame)
    return data.data;
  }
  throw new Error(data.error || 'Failed to start call');
}
```

---

## 4. Key Rocket.Chat REST API Cheatsheet

Header requirements for authenticated endpoints:
```http
X-Auth-Token: <token>
X-User-Id: <user_id>
Content-Type: application/json
```

| Action | Method | Endpoint | Payload / Params |
| :--- | :--- | :--- | :--- |
| **Login** | `POST` | `/api/v1/login` | `{ "user": "username", "password": "pwd" }` |
| **Send Message** | `POST` | `/api/v1/chat.postMessage` | `{ "roomId": "RID", "text": "Hello" }` |
| **Upload Voice/File** | `POST` | `/api/v1/rooms.upload/{roomId}` | `multipart/form-data; file=...` |
| **Get Message History**| `GET` | `/api/v1/chat.getMessages?roomId=RID` | Query: `count=50` |
| **Start Conference** | `POST` | `/api/v1/video-conference/start` | `{ "roomId": "RID", "title": "Call" }` |
| **Call Info** | `GET` | `/api/v1/video-conference/info?callId=CID`| Query: `callId` |
| **User Presence** | `POST` | `/api/v1/users.setStatus` | `{ "status": "online", "message": "..." }` |

---

## 5. UI/UX Rules for Chat & Calling

- **Zero Echo**: Always mute local audio playback when recording or in active WebRTC sessions.
- **Permission Gracefulness**: Check `navigator.permissions.query({ name: 'microphone' })` and display a clear prompt before requesting media access.
- **Compact Floating Bar**: When minimizing an active call, show a floating pill at the bottom/top of the screen showing:
  `[🟢 02:45] [🎙️ Muted] [📹 Off] [🔴 End Call]`.
- **Keyboard Shortcuts**: Space to toggle mute (Walkie-talkie mode / Push-to-Talk), Esc to close call drawer.
