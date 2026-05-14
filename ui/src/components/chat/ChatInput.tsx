import React, { useState, useRef, useEffect, useCallback } from "react";
import type { VoiceState } from "../../hooks/useVoice";
import type { ImageAttachment } from "../../hooks/useWebSocket";
import "../../styles/chat.css";

type VoiceProps = {
  voiceState: VoiceState;
  startRecording: () => void;
  stopRecording: () => void;
  isMicAvailable: boolean;
  isWakeWordReady: boolean;
  ttsAudioPlaying: boolean;
  cancelTTS: () => void;
};

type Props = {
  onSend: (text: string, images?: ImageAttachment[]) => void;
  disabled?: boolean;
  disableImages?: boolean;
  voice?: VoiceProps;
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function fileToImageAttachment(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    // Validate file size
    if (file.size > MAX_IMAGE_SIZE) {
      reject(new Error(`Image too large: ${(file.size / 1024 / 1024).toFixed(2)}MB (max 5MB)`));
      return;
    }

    // Validate file type
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      reject(new Error(`Invalid image type: ${file.type}. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve({ dataUrl, mediaType: file.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ChatInput({ onSend, disabled, disableImages, voice }: Props) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if ((!trimmed && images.length === 0) || disabled) return;
    const attachedImages = disableImages ? undefined : (images.length > 0 ? images : undefined);
    onSend(trimmed, attachedImages);
    setText("");
    setImages([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 150) + "px";
    }
  };

  const addImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const attachments = await Promise.all(imageFiles.map(fileToImageAttachment));
    setImages((prev) => [...prev, ...attachments].slice(0, 4)); // max 4 images
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (disableImages) return;
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean) as File[];
    addImageFiles(files);
  }, [addImageFiles, disableImages]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    addImageFiles(Array.from(e.target.files));
    e.target.value = ""; // reset so same file can be re-selected
  }, [addImageFiles]);

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const getMicTitle = () => {
    if (!voice) return "";
    if (voice.ttsAudioPlaying) return "Stop speaking";
    if (voice.voiceState === "recording") return "Click to send";
    if (voice.isWakeWordReady) return 'Say "Hey JARVIS" or click to speak';
    return "Click to speak";
  };

  const getMicIcon = () => {
    if (!voice) return "";
    if (voice.ttsAudioPlaying) return "\u23F9"; // stop
    if (voice.voiceState === "recording") return "\u25CF"; // filled circle
    if (voice.voiceState === "processing") return "\u23F3"; // hourglass
    return "\uD83C\uDFA4"; // microphone
  };

  const getMicClass = () => {
    if (!voice) return "chat-mic-btn";
    if (voice.voiceState === "recording") return "chat-mic-btn chat-mic-btn-recording";
    if (voice.ttsAudioPlaying) return "chat-mic-btn chat-mic-btn-speaking";
    return "chat-mic-btn";
  };

  const handleMicClick = () => {
    if (!voice) return;
    if (voice.ttsAudioPlaying) {
      voice.cancelTTS();
      return;
    }
    if (voice.voiceState === "recording") {
      voice.stopRecording();
    } else if (voice.voiceState === "idle" || voice.voiceState === "wake_detected") {
      voice.startRecording();
    }
  };

  return (
    <div className="chat-input-area">
      {/* Image preview strip */}
      {!disableImages && images.length > 0 && (
        <div className="chat-image-previews">
          {images.map((img, i) => (
            <div key={i} className="chat-image-preview-wrap">
              <img src={img.dataUrl} alt={`attachment ${i + 1}`} className="chat-image-preview" />
              <button className="chat-image-remove" onClick={() => removeImage(i)} title="Remove image">&#x2715;</button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input-row">
        {/* Hidden file input */}
        {!disableImages && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        )}

        {/* Image attach button */}
        {!disableImages && (
          <button
            className="chat-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach image (or paste)"
            disabled={disabled}
          >
            &#x1F4CE;
          </button>
        )}

        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          placeholder="Type a message..."
          disabled={disabled}
          rows={1}
        />

        {/* Mic button */}
        {voice?.isMicAvailable && (
          <button
            className={getMicClass()}
            onClick={handleMicClick}
            title={getMicTitle()}
            disabled={voice.voiceState === "processing"}
          >
            {getMicIcon()}
          </button>
        )}

        {/* Send button */}
        <button
          className="chat-send-btn"
          onClick={handleSubmit}
          disabled={(!text.trim() && images.length === 0) || disabled}
          title="Send message"
        >
          &#x2191;
        </button>
      </div>
      <div className="chat-hints">
        Enter to send &middot; Shift+Enter for new line{!disableImages && <> &middot; Paste image to attach</>}
      </div>
    </div>
  );
}
