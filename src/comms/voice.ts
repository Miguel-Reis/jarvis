import type { STTConfig, TTSConfig } from '../config/types.ts';
import { Communicate } from 'edge-tts-universal';

export interface STTProvider {
  transcribe(audio: Buffer): Promise<string>;
}

export interface TTSProvider {
  synthesize(text: string): Promise<Buffer>;
  synthesizeStream(text: string): AsyncIterable<Buffer>;
}

/**
 * OpenAI Whisper STT — uses the OpenAI /v1/audio/transcriptions endpoint.
 */
export class OpenAIWhisperSTT implements STTProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'whisper-1') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async transcribe(audio: Buffer): Promise<string> {
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/webm' }), 'audio.webm');
    formData.append('model', this.model);
    formData.append('language', 'en');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI STT error (${response.status}): ${err}`);
    }

    const result = await response.json() as any;
    return result.text;
  }
}

/**
 * Groq Whisper STT — uses Groq's OpenAI-compatible transcriptions endpoint.
 */
export class GroqWhisperSTT implements STTProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'whisper-large-v3-turbo') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async transcribe(audio: Buffer): Promise<string> {
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/webm' }), 'audio.webm');
    formData.append('model', this.model);
    formData.append('language', 'en');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Groq STT error (${response.status}): ${err}`);
    }

    const result = await response.json() as any;
    return result.text;
  }
}

/**
 * Local Whisper STT — connects to a whisper.cpp HTTP server or OpenAI-compatible endpoint.
 */
export type LocalWhisperServerType = 'whisper_cpp' | 'openai_compatible';

export class LocalWhisperSTT implements STTProvider {
  private endpoint: string;
  private model: string;
  private serverType: LocalWhisperServerType;

  constructor(
    endpoint: string = 'http://localhost:8080',
    model?: string,
    serverType: LocalWhisperServerType = 'whisper_cpp',
  ) {
    this.endpoint = endpoint;
    this.model = model ?? 'base';
    this.serverType = serverType;
  }

  private resolveUrl(): string {
    const normalized = this.endpoint.replace(/\/+$/, '');
    if (this.serverType === 'whisper_cpp') {
      const hasPath = /\/(inference|asr|transcribe)$/.test(normalized);
      return hasPath ? normalized : `${normalized}/inference`;
    }
    return normalized;
  }

  private buildForm(audio: Buffer): FormData {
    const formData = new FormData();
    if (this.serverType === 'whisper_cpp') {
      formData.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'audio.wav');
      formData.append('response_format', 'json');
      formData.append('temperature', '0.0');
      formData.append('temperature_inc', '0.2');
    } else {
      formData.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'audio.wav');
      formData.append('model', this.model);
      formData.append('language', 'en');
    }
    return formData;
  }

  private async parseResponse(response: Response): Promise<string> {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const result = await response.json() as any;
      return String(
        result.text ??
        result.transcript ??
        result.data?.text ??
        ''
      ).trim();
    }
    return (await response.text()).trim();
  }

  async transcribe(audio: Buffer): Promise<string> {
    const url = this.resolveUrl();
    const formData = this.buildForm(audio);

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Local Whisper STT error (${response.status}): ${err}`);
    }

    const transcript = await this.parseResponse(response);
    if (!transcript) {
      throw new Error('Local Whisper STT returned empty transcription');
    }
    return transcript;
  }
}

/**
 * Factory: create the right STT provider from config.
 * Returns null if the selected provider lacks required credentials.
 */
export function createSTTProvider(config: STTConfig): STTProvider | null {
  switch (config.provider) {
    case 'openai':
      if (!config.openai?.api_key) return null;
      return new OpenAIWhisperSTT(config.openai.api_key, config.openai.model);
    case 'groq':
      if (!config.groq?.api_key) return null;
      return new GroqWhisperSTT(config.groq.api_key, config.groq.model);
    case 'local':
      return new LocalWhisperSTT(config.local?.endpoint, config.local?.model, config.local?.server_type);
    default:
      return null;
  }
}

/**
 * Edge TTS Provider — uses Microsoft Edge's online TTS service (free, no API key).
 * Runs server-side only (browser WebSocket can't set required headers).
 */
export class EdgeTTSProvider implements TTSProvider {
  private voice: string;
  private rate: string;
  private volume: string;

  constructor(voice = 'en-US-AriaNeural', rate = '+0%', volume = '+0%') {
    this.voice = voice;
    this.rate = rate;
    this.volume = volume;
  }

  async synthesize(text: string): Promise<Buffer> {
    const comm = new Communicate(text, {
      voice: this.voice,
      rate: this.rate,
      volume: this.volume,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of comm.stream()) {
      if (chunk.type === 'audio' && chunk.data) {
        chunks.push(chunk.data);
      }
    }
    return Buffer.concat(chunks);
  }

  /**
   * Streaming variant: synthesizes text and yields a single complete MP3 buffer.
   * Called per-sentence so the caller can pipeline multiple sentences.
   * Each yielded buffer is a valid, decodable MP3 file.
   */
  async *synthesizeStream(text: string): AsyncIterable<Buffer> {
    // Collect all chunks into a complete MP3 — individual edge-tts
    // fragments are not valid standalone audio files
    const audio = await this.synthesize(text);
    if (audio.length > 0) {
      yield audio;
    }
  }
}

/**
 * Azure Speech TTS Provider — Microsoft Azure Cognitive Services Speech.
 * True streaming with low latency (100-300ms), excellent Portuguese voices.
 * Supports SSML for fine-grained control.
 */
export class AzureSpeechTTSProvider implements TTSProvider {
  private apiKey: string;
  private region: string;
  private voice: string;
  private outputFormat: string;

  constructor(
    apiKey: string,
    region: string = 'westeurope',
    voice: string = 'pt-PT-DuarteNeural',
    outputFormat: string = 'audio-24khz-48kbitrate-mono-mp3'
  ) {
    this.apiKey = apiKey;
    this.region = region;
    this.voice = voice;
    this.outputFormat = outputFormat;
  }

  async synthesize(text: string): Promise<Buffer> {
    const response = await fetch(
      `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': this.outputFormat,
        },
        body: `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xml:lang="${this.voice.split('-')[0]}-${this.voice.split('-')[1]}">
  <voice xml:lang="${this.voice.split('-')[0]}-${this.voice.split('-')[1]}" xml:name="${this.voice}">
    ${text}
  </voice>
</speak>`,
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Azure Speech TTS error (${response.status}): ${err}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async *synthesizeStream(text: string): AsyncIterable<Buffer> {
    // Azure Speech streaming: send SSML with sentence-by-sentence breaks
    // and yield audio chunks as they arrive
    const response = await fetch(
      `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': this.outputFormat,
        },
        body: `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xml:lang="${this.voice.split('-')[0]}-${this.voice.split('-')[1]}">
  <voice xml:lang="${this.voice.split('-')[0]}-${this.voice.split('-')[1]}" xml:name="${this.voice}">
    ${text}
  </voice>
</speak>`,
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Azure Speech TTS error (${response.status}): ${err}`);
    }

    // Stream the response body
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Azure Speech TTS: no response body');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          yield Buffer.from(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * ElevenLabs TTS Provider — high-quality personalized voices via ElevenLabs API.
 * Supports true streaming (chunks are valid playable audio).
 */
export class ElevenLabsTTSProvider implements TTSProvider {
  private apiKey: string;
  private voiceId: string;
  private model: string;
  private stability: number;
  private similarityBoost: number;

  constructor(config: NonNullable<TTSConfig['elevenlabs']>) {
    this.apiKey = config.api_key;
    this.voiceId = config.voice_id ?? '21m00Tcm4TlvDq8ikWAM'; // Rachel (default)
    this.model = config.model ?? 'eleven_flash_v2_5';
    this.stability = config.stability ?? 0.5;
    this.similarityBoost = config.similarity_boost ?? 0.75;
  }

  async synthesize(text: string): Promise<Buffer> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: this.model,
          voice_settings: {
            stability: this.stability,
            similarity_boost: this.similarityBoost,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`ElevenLabs TTS error (${response.status}): ${err}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async *synthesizeStream(text: string): AsyncIterable<Buffer> {
    // Collect into a complete MP3 per sentence — individual streaming
    // fragments are not decodable by the browser's AudioContext.decodeAudioData
    const audio = await this.synthesize(text);
    if (audio.length > 0) {
      yield audio;
    }
  }
}

/**
 * Fetch available voices from ElevenLabs API.
 */
export async function listElevenLabsVoices(apiKey: string): Promise<{
  voice_id: string;
  name: string;
  category: string;
}[]> {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs voices error (${response.status}): ${err}`);
  }

  const data = await response.json() as any;
  return (data.voices ?? []).map((v: any) => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category ?? 'unknown',
  }));
}

/**
 * Google Cloud Text-to-Speech Provider — WaveNet voices with streaming.
 * Excellent quality and natural sounding, supports many languages.
 */
export class GoogleCloudTTSProvider implements TTSProvider {
  private apiKey: string;
  private voiceName: string;
  private languageCode: string;

  constructor(
    apiKey: string,
    voiceName: string = 'pt-PT-Standard-C',
    languageCode: string = 'pt-PT'
  ) {
    this.apiKey = apiKey;
    this.voiceName = voiceName;
    this.languageCode = languageCode;
  }

  async synthesize(text: string): Promise<Buffer> {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: this.languageCode,
            name: this.voiceName,
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 1.0,
            pitch: 0.0,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Google Cloud TTS error (${response.status}): ${err}`);
    }

    const data = await response.json() as { audioContent: string };
    return Buffer.from(data.audioContent, 'base64');
  }

  async *synthesizeStream(text: string): AsyncIterable<Buffer> {
    // Google Cloud TTS doesn't support true streaming via REST API
    // Synthesize complete audio and yield as single chunk
    const audio = await this.synthesize(text);
    if (audio.length > 0) {
      yield audio;
    }
  }
}

/**
 * OpenAI Text-to-Speech Provider — Simple API with 6 voices.
 * Good quality, low cost, easy setup.
 */
export class OpenAITTSProvider implements TTSProvider {
  private apiKey: string;
  private voice: string;
  private model: string;

  constructor(
    apiKey: string,
    voice: string = 'alloy',
    model: string = 'tts-1'
  ) {
    this.apiKey = apiKey;
    this.voice = voice;
    this.model = model;
  }

  async synthesize(text: string): Promise<Buffer> {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        voice: this.voice,
        response_format: 'mp3',
        speed: 1.0,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI TTS error (${response.status}): ${err}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async *synthesizeStream(text: string): AsyncIterable<Buffer> {
    // OpenAI TTS streaming: the API returns a streaming response
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        voice: this.voice,
        response_format: 'mp3',
        speed: 1.0,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI TTS error (${response.status}): ${err}`);
    }

    // Stream the response body
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('OpenAI TTS: no response body');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          yield Buffer.from(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * Factory: create the right TTS provider from config.
 * Returns null if TTS is disabled.
 */
export function createTTSProvider(config: TTSConfig): TTSProvider | null {
  if (!config.enabled) return null;

  if (config.provider === 'elevenlabs') {
    if (!config.elevenlabs?.api_key) return null;
    return new ElevenLabsTTSProvider(config.elevenlabs);
  }

  if (config.provider === 'azure') {
    if (!config.azure?.api_key) return null;
    return new AzureSpeechTTSProvider(
      config.azure.api_key,
      config.azure.region ?? 'westeurope',
      config.voice ?? 'pt-PT-DuarteNeural',
      config.azure.output_format
    );
  }

  if (config.provider === 'google') {
    if (!config.google?.api_key) return null;
    return new GoogleCloudTTSProvider(
      config.google.api_key,
      config.voice ?? 'pt-PT-Standard-C',
      config.google.language_code ?? 'pt-PT'
    );
  }

  if (config.provider === 'openai') {
    if (!config.openai?.api_key) return null;
    return new OpenAITTSProvider(
      config.openai.api_key,
      config.voice ?? 'alloy',
      config.openai.model ?? 'tts-1'
    );
  }

  // Default: Edge TTS
  return new EdgeTTSProvider(config.voice, config.rate, config.volume);
}

/**
 * Split text into sentences for streaming TTS.
 * Each sentence is synthesized and played independently for low latency.
 */
export function splitIntoSentences(text: string): string[] {
  // Collapse code blocks to avoid splitting on periods inside code
  const collapsed = text.replace(/```[\s\S]*?```/g, '[code block]');
  // Split on sentence-ending punctuation followed by whitespace + capital letter,
  // or on double newlines (paragraph breaks)
  const sentences = collapsed
    .split(/(?<=[.!?])\s+(?=[A-Z])|(?<=\n\n)/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return sentences.length > 0 ? sentences : [text];
}

/**
 * Strip markdown formatting from text for natural-sounding TTS output.
 * Removes headers, bold, italic, code, links, and normalizes whitespace.
 */
export function stripMarkdownForTTS(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, '')           // Remove headers
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')  // Remove bold/italic
    .replace(/`([^`]+)`/g, '$1')          // Remove inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // Remove links, keep text
    .replace(/\n{2,}/g, '. ')             // Convert paragraph breaks to periods
    .replace(/\n/g, ' ')                  // Convert newlines to spaces
    .replace(/\s{2,}/g, ' ')              // Collapse multiple spaces
    .trim()
    .slice(0, 300);                       // Limit length for TTS
}
