# Rocket.Chat Calling & Messaging Reference Guide

## 1. WebRTC Call Component Pattern (React / Modern Web)

```jsx
import React, { useState, useEffect, useRef } from 'react';

export function CallOverlay({ callUrl, isAudioOnly, onEndCall }) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(isAudioOnly);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setDuration(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDuration = (s) => {
    const mins = Math.floor(s / 60).toString().padStart(2, '0');
    const secs = (s % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-slate-900/80 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></span>
          <span className="font-semibold">{isAudioOnly ? 'Cuộc gọi thoại' : 'Cuộc gọi video'}</span>
          <span className="text-slate-400 font-mono text-sm">{formatDuration(duration)}</span>
        </div>
      </div>

      {/* Frame / Feed */}
      <div className="flex-1 relative">
        <iframe
          src={callUrl}
          allow="camera; microphone; display-capture; autoplay"
          className="w-full h-full border-0"
          title="Video Conference"
        />
      </div>

      {/* Floating Bottom Control Bar */}
      <div className="flex items-center justify-center gap-4 py-4 bg-slate-900/90 border-t border-slate-800">
        <button
          onClick={() => setIsMuted(!isMuted)}
          className={`p-3 rounded-full ${isMuted ? 'bg-amber-600' : 'bg-slate-700 hover:bg-slate-600'}`}
          title={isMuted ? 'Bật mic' : 'Tắt mic'}
        >
          {isMuted ? '🎙️❌' : '🎙️'}
        </button>
        <button
          onClick={() => setIsVideoOff(!isVideoOff)}
          className={`p-3 rounded-full ${isVideoOff ? 'bg-amber-600' : 'bg-slate-700 hover:bg-slate-600'}`}
          title={isVideoOff ? 'Bật camera' : 'Tắt camera'}
        >
          {isVideoOff ? '📹❌' : '📹'}
        </button>
        <button
          onClick={onEndCall}
          className="p-3 px-6 rounded-full bg-rose-600 hover:bg-rose-500 font-bold flex items-center gap-2"
          title="Kết thúc cuộc gọi"
        >
          <span>📞</span> Kết thúc
        </button>
      </div>
    </div>
  );
}
```

## 2. Real-Time DDP WebSocket Events
Rocket.Chat communicates changes in real time via DDP:
- Subscribe to room changes:
  `{"msg": "sub", "id": "sub1", "name": "stream-room-messages", "params": ["roomId", false]}`
- Typing notification:
  `{"msg": "method", "method": "stream-notify-room", "params": ["roomId/typing", "username", true]}`
