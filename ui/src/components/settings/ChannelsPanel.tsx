import React, { useState, useEffect } from "react";
import { useApiData, api } from "../../hooks/useApi";

type ChannelStatusData = {
  channels: Record<string, boolean>;
  stt: string | null;
};

type ChannelConfigData = {
  telegram: { enabled: boolean; has_token: boolean; allowed_users: number[] };
  discord: { enabled: boolean; has_token: boolean; allowed_users: string[]; guild_id: string | null };
  whatsapp: { enabled: boolean; has_phone_number_id: boolean; has_access_token: boolean; has_verify_token: boolean; allowed_users: string[] };
};

type STTConfigData = {
  provider: string;
  has_openai_key: boolean;
  has_groq_key: boolean;
  local_endpoint: string | null;
  local_server_type: string;
};

type TTSConfigData = {
  enabled: boolean;
  provider: string;
  voice: string;
  rate: string;
  volume: string;
  elevenlabs: {
    has_api_key: boolean;
    voice_id: string | null;
    model: string;
    stability: number;
    similarity_boost: number;
  } | null;
};

type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category: string;
};

export function ChannelsPanel() {
  const { data: status, refetch: refetchStatus } = useApiData<ChannelStatusData>("/api/channels/status", []);
  const { data: channelCfg, refetch: refetchCfg } = useApiData<ChannelConfigData>("/api/config/channels", []);
  const { data: sttCfg, refetch: refetchStt } = useApiData<STTConfigData>("/api/config/stt", []);
  const { data: ttsCfg, refetch: refetchTts } = useApiData<TTSConfigData>("/api/config/tts", []);

  // Wake word
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() =>
    localStorage.getItem('jarvis_wake_word_enabled') !== 'false'
  );

  const handleWakeWordToggle = (enabled: boolean) => {
    setWakeWordEnabled(enabled);
    localStorage.setItem('jarvis_wake_word_enabled', String(enabled));
    window.dispatchEvent(new StorageEvent('storage', { key: 'jarvis_wake_word_enabled', newValue: String(enabled) }));
  };

  // Telegram form
  const [tgToken, setTgToken] = useState("");
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgAllowed, setTgAllowed] = useState("");

  // Discord form
  const [dcToken, setDcToken] = useState("");
  const [dcEnabled, setDcEnabled] = useState(false);
  const [dcAllowed, setDcAllowed] = useState("");
  const [dcGuild, setDcGuild] = useState("");

  // WhatsApp form
  const [waEnabled, setWaEnabled] = useState(false);
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waAccessToken, setWaAccessToken] = useState("");
  const [waVerifyToken, setWaVerifyToken] = useState("");
  const [waAllowed, setWaAllowed] = useState("");

  // STT form
  const [sttProvider, setSttProvider] = useState("openai");
  const [sttKey, setSttKey] = useState("");
  const [sttEndpoint, setSttEndpoint] = useState("http://localhost:8080");
  const [sttServerType, setSttServerType] = useState("whisper_cpp");

  // TTS form
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsProvider, setTtsProvider] = useState("edge");
  const [ttsVoice, setTtsVoice] = useState("en-US-AriaNeural");
  const [ttsRate, setTtsRate] = useState("+0%");
  const [elApiKey, setElApiKey] = useState("");
  const [elVoiceId, setElVoiceId] = useState("");
  const [elModel, setElModel] = useState("eleven_flash_v2_5");
  const [elVoices, setElVoices] = useState<ElevenLabsVoice[]>([]);
  const [elVoicesLoading, setElVoicesLoading] = useState(false);

  // Edge TTS voices
  const [edgeVoices, setEdgeVoices] = useState<{ voice_id: string; name: string; locale: string }[]>([]);
  const [edgeVoicesLoading, setEdgeVoicesLoading] = useState(false);

  // Messages
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  // Sync form state with loaded config
  useEffect(() => {
    if (channelCfg) {
      setTgEnabled(channelCfg.telegram.enabled);
      setTgAllowed(channelCfg.telegram.allowed_users.join(", "));
      setDcEnabled(channelCfg.discord.enabled);
      setDcAllowed(channelCfg.discord.allowed_users.join(", "));
      setDcGuild(channelCfg.discord.guild_id ?? "");
      setWaEnabled(channelCfg.whatsapp.enabled);
      setWaAllowed(channelCfg.whatsapp.allowed_users.join(", "));
    }
  }, [channelCfg]);

  useEffect(() => {
    if (sttCfg) {
      setSttProvider(sttCfg.provider);
      if (sttCfg.local_endpoint) setSttEndpoint(sttCfg.local_endpoint);
      if (sttCfg.local_server_type) setSttServerType(sttCfg.local_server_type);
    }
  }, [sttCfg]);

  useEffect(() => {
    if (ttsCfg) {
      setTtsEnabled(ttsCfg.enabled);
      setTtsProvider(ttsCfg.provider || "edge");
      setTtsVoice(ttsCfg.voice);
      setTtsRate(ttsCfg.rate);
      if (ttsCfg.elevenlabs) {
        setElVoiceId(ttsCfg.elevenlabs.voice_id ?? "");
        setElModel(ttsCfg.elevenlabs.model);
      }
    }
  }, [ttsCfg]);

  // Fetch Edge TTS voices on mount
  useEffect(() => {
    setEdgeVoicesLoading(true);
    api<{ voice_id: string; name: string; locale: string }[]>("/api/tts/voices?provider=edge&lang=en")
      .then(v => setEdgeVoices(v))
      .catch(() => {})
      .finally(() => setEdgeVoicesLoading(false));
  }, []);

  // Fetch ElevenLabs voices when provider is elevenlabs and key is configured
  const fetchElVoices = async () => {
    setElVoicesLoading(true);
    try {
      const voices = await api<ElevenLabsVoice[]>("/api/tts/voices?provider=elevenlabs");
      setElVoices(voices);
    } catch {
      setElVoices([]);
    }
    setElVoicesLoading(false);
  };

  useEffect(() => {
    if (ttsProvider === "elevenlabs" && ttsCfg?.elevenlabs?.has_api_key) {
      fetchElVoices();
    }
  }, [ttsProvider, ttsCfg?.elevenlabs?.has_api_key]);

  const saveChannels = async () => {
    try {
      const body: Record<string, unknown> = {};

      body.telegram = {
        enabled: tgEnabled,
        ...(tgToken ? { bot_token: tgToken } : {}),
        allowed_users: tgAllowed.split(",").map(s => s.trim()).filter(Boolean).map(Number),
      };

      body.discord = {
        enabled: dcEnabled,
        ...(dcToken ? { bot_token: dcToken } : {}),
        allowed_users: dcAllowed.split(",").map(s => s.trim()).filter(Boolean),
        ...(dcGuild ? { guild_id: dcGuild } : {}),
      };

      body.whatsapp = {
        enabled: waEnabled,
        ...(waPhoneNumberId ? { phone_number_id: waPhoneNumberId } : {}),
        ...(waAccessToken ? { access_token: waAccessToken } : {}),
        ...(waVerifyToken ? { webhook_verify_token: waVerifyToken } : {}),
        allowed_users: waAllowed.split(",").map(s => s.trim()).filter(Boolean),
      };

      await api("/api/config/channels", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setTgToken("");
      setDcToken("");
      setWaAccessToken("");
      setMsg({ text: "Channel config saved. Restart JARVIS to apply.", type: "success" });
      refetchCfg();
      refetchStatus();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to save", type: "error" });
    }
  };

  const saveSTT = async () => {
    try {
      const body: Record<string, unknown> = { provider: sttProvider };

      if (sttProvider === "openai" && sttKey) {
        body.openai = { api_key: sttKey };
      } else if (sttProvider === "groq" && sttKey) {
        body.groq = { api_key: sttKey };
      } else if (sttProvider === "local") {
        body.local = { endpoint: sttEndpoint, server_type: sttServerType };
      }

      await api("/api/config/stt", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setSttKey("");
      setMsg({ text: "STT config saved. Restart JARVIS to apply.", type: "success" });
      refetchStt();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to save", type: "error" });
    }
  };

  const saveTTS = async () => {
    try {
      const body: Record<string, unknown> = {
        enabled: ttsEnabled,
        provider: ttsProvider,
        voice: ttsVoice,
        rate: ttsRate,
      };

      if (ttsProvider === "elevenlabs") {
        body.elevenlabs = {
          ...(elApiKey ? { api_key: elApiKey } : {}),
          voice_id: elVoiceId || undefined,
          model: elModel,
        };
      }

      await api("/api/config/tts", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setElApiKey("");
      setMsg({ text: "TTS config saved and applied.", type: "success" });
      refetchTts();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to save", type: "error" });
    }
  };

  return (
    <div style={cardStyle}>
      <h3 style={headerStyle}>Communication Channels</h3>

      {msg && (
        <div style={{ ...msgStyle, color: msg.type === "error" ? "var(--j-error)" : "var(--j-success)" }}>
          {msg.text}
        </div>
      )}

      {/* Voice Activation Section */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Voice Activation</div>
        <p style={hintStyle}>
          When enabled, JARVIS listens for <strong>"Hey Jarvis"</strong> to start recording.
          Disable if you prefer push-to-talk (microphone button in chat) or want to save CPU.
        </p>
        <label style={toggleRowStyle}>
          <input
            type="checkbox"
            checked={wakeWordEnabled}
            onChange={e => handleWakeWordToggle(e.target.checked)}
          />
          <span style={{ fontSize: "13px", color: "var(--j-text)" }}>Enable wake word detection</span>
        </label>
      </div>

      {/* Telegram Section */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={labelStyle}>Telegram</div>
          <div style={rowStyle}>
            <StatusDot color={status?.channels.telegram ? "var(--j-success)" : "var(--j-text-muted)"} />
            <span style={{ fontSize: "11px", color: "var(--j-text-dim)" }}>
              {status?.channels.telegram ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        <p style={hintStyle}>
          Create a bot via <strong>@BotFather</strong> on Telegram, then paste the token here.
        </p>

        <label style={toggleRowStyle}>
          <input
            type="checkbox"
            checked={tgEnabled}
            onChange={e => setTgEnabled(e.target.checked)}
          />
          <span style={{ fontSize: "13px", color: "var(--j-text)" }}>Enabled</span>
          {channelCfg?.telegram.has_token && (
            <span style={{ fontSize: "11px", color: "var(--j-text-muted)", marginLeft: "auto" }}>
              Token configured
            </span>
          )}
        </label>

        <input
          style={inputStyle}
          type="password"
          placeholder="Bot Token (leave empty to keep existing)"
          value={tgToken}
          onChange={e => setTgToken(e.target.value)}
        />
        <input
          style={inputStyle}
          type="text"
          placeholder="Allowed User IDs (comma-separated, empty = all)"
          value={tgAllowed}
          onChange={e => setTgAllowed(e.target.value)}
        />
      </div>

      {/* Discord Section */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={labelStyle}>Discord</div>
          <div style={rowStyle}>
            <StatusDot color={status?.channels.discord ? "var(--j-success)" : "var(--j-text-muted)"} />
            <span style={{ fontSize: "11px", color: "var(--j-text-dim)" }}>
              {status?.channels.discord ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        <p style={hintStyle}>
          Create an app at <strong>discord.com/developers</strong>, add a Bot, copy the token.
          Enable <em>Message Content Intent</em> in Bot settings.
        </p>

        <label style={toggleRowStyle}>
          <input
            type="checkbox"
            checked={dcEnabled}
            onChange={e => setDcEnabled(e.target.checked)}
          />
          <span style={{ fontSize: "13px", color: "var(--j-text)" }}>Enabled</span>
          {channelCfg?.discord.has_token && (
            <span style={{ fontSize: "11px", color: "var(--j-text-muted)", marginLeft: "auto" }}>
              Token configured
            </span>
          )}
        </label>

        <input
          style={inputStyle}
          type="password"
          placeholder="Bot Token (leave empty to keep existing)"
          value={dcToken}
          onChange={e => setDcToken(e.target.value)}
        />
        <input
          style={inputStyle}
          type="text"
          placeholder="Allowed User IDs (comma-separated, empty = all)"
          value={dcAllowed}
          onChange={e => setDcAllowed(e.target.value)}
        />
        <input
          style={inputStyle}
          type="text"
          placeholder="Guild ID (optional, restrict to one server)"
          value={dcGuild}
          onChange={e => setDcGuild(e.target.value)}
        />
      </div>

      {/* WhatsApp Section */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={labelStyle}>WhatsApp</div>
          <div style={rowStyle}>
            <StatusDot color={status?.channels.whatsapp ? "var(--j-success)" : "var(--j-text-muted)"} />
            <span style={{ fontSize: "11px", color: "var(--j-text-dim)" }}>
              {status?.channels.whatsapp ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        <p style={hintStyle}>
          Requires a <strong>Meta Business account</strong> with a WhatsApp Cloud API app.
          Set the webhook URL to <code style={{ fontSize: "11px", background: "var(--j-bg)", padding: "1px 4px", borderRadius: "3px" }}>https://your-domain/webhooks/whatsapp</code>.
        </p>

        <label style={toggleRowStyle}>
          <input
            type="checkbox"
            checked={waEnabled}
            onChange={e => setWaEnabled(e.target.checked)}
          />
          <span style={{ fontSize: "13px", color: "var(--j-text)" }}>Enabled</span>
        </label>

        <input
          style={inputStyle}
          type="text"
          placeholder={`Phone Number ID${channelCfg?.whatsapp.has_phone_number_id ? " (configured)" : ""}`}
          value={waPhoneNumberId}
          onChange={e => setWaPhoneNumberId(e.target.value)}
        />
        <input
          style={inputStyle}
          type="password"
          placeholder={`System User Access Token${channelCfg?.whatsapp.has_access_token ? " (configured)" : ""}`}
          value={waAccessToken}
          onChange={e => setWaAccessToken(e.target.value)}
        />
        <input
          style={inputStyle}
          type="text"
          placeholder={`Webhook Verify Token${channelCfg?.whatsapp.has_verify_token ? " (configured)" : ""}`}
          value={waVerifyToken}
          onChange={e => setWaVerifyToken(e.target.value)}
        />
        <input
          style={inputStyle}
          type="text"
          placeholder="Allowed phone numbers in E.164 format (comma-separated, empty = all)"
          value={waAllowed}
          onChange={e => setWaAllowed(e.target.value)}
        />
      </div>

      <button style={primaryBtnStyle} onClick={saveChannels}>
        Save Channel Config
      </button>

      {/* STT Section */}
      <div style={{ ...sectionStyle, marginTop: "16px" }}>
        <div style={labelStyle}>Voice Transcription (STT)</div>
        <p style={hintStyle}>
          Enables voice message transcription on Telegram and Discord.
          Provide an API key for the selected provider.
        </p>

        <select
          style={inputStyle}
          value={sttProvider}
          onChange={e => setSttProvider(e.target.value)}
        >
          <option value="openai">OpenAI Whisper</option>
          <option value="groq">Groq Whisper</option>
          <option value="local">Local Whisper (whisper.cpp)</option>
        </select>

        {(sttProvider === "openai" || sttProvider === "groq") && (
          <>
            <input
              style={inputStyle}
              type="password"
              placeholder={`${sttProvider === "openai" ? "OpenAI" : "Groq"} API Key (leave empty to keep existing)`}
              value={sttKey}
              onChange={e => setSttKey(e.target.value)}
            />
            {((sttProvider === "openai" && sttCfg?.has_openai_key) ||
              (sttProvider === "groq" && sttCfg?.has_groq_key)) && (
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>
                API key configured
              </span>
            )}
          </>
        )}

        {sttProvider === "local" && (
          <>
            <input
              style={inputStyle}
              type="text"
              placeholder="Whisper endpoint (e.g., http://localhost:8080)"
              value={sttEndpoint}
              onChange={e => setSttEndpoint(e.target.value)}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Server Type</span>
              <select
                style={inputStyle}
                value={sttServerType}
                onChange={e => setSttServerType(e.target.value)}
              >
                <option value="whisper_cpp">whisper.cpp</option>
                <option value="openai_compatible">OpenAI-compatible</option>
              </select>
            </div>
          </>
        )}

        <button style={{ ...primaryBtnStyle, marginTop: "8px" }} onClick={saveSTT}>
          Save STT Config
        </button>
      </div>

      {/* TTS Section */}
      <div style={{ ...sectionStyle, marginTop: "16px", borderBottom: "none" }}>
        <div style={labelStyle}>Text-to-Speech (TTS)</div>
        <p style={hintStyle}>
          Enables voice responses from JARVIS via the dashboard.
        </p>

        <label style={toggleRowStyle}>
          <input
            type="checkbox"
            checked={ttsEnabled}
            onChange={e => setTtsEnabled(e.target.checked)}
          />
          <span style={{ fontSize: "13px", color: "var(--j-text)" }}>Enabled</span>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Provider</span>
          <select
            style={inputStyle}
            value={ttsProvider}
            onChange={e => setTtsProvider(e.target.value)}
          >
            <option value="edge">Edge TTS (Free)</option>
            <option value="elevenlabs">ElevenLabs (API Key)</option>
          </select>
        </div>

        {ttsProvider === "edge" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Voice</span>
              {edgeVoicesLoading ? (
                <span style={{ fontSize: "12px", color: "var(--j-text-dim)" }}>Loading voices…</span>
              ) : (
                <select
                  style={inputStyle}
                  value={ttsVoice}
                  onChange={e => setTtsVoice(e.target.value)}
                >
                  {edgeVoices.length > 0
                    ? edgeVoices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)
                    : (
                      <>
                        <option value="en-US-AriaNeural">Aria (US Female)</option>
                        <option value="en-US-GuyNeural">Guy (US Male)</option>
                        <option value="en-GB-SoniaNeural">Sonia (UK Female)</option>
                        <option value="en-AU-NatashaNeural">Natasha (AU Female)</option>
                        <option value="en-US-JennyNeural">Jenny (US Female)</option>
                        <option value="en-US-DavisNeural">Davis (US Male)</option>
                      </>
                    )
                  }
                </select>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Speaking Rate</span>
              <select
                style={inputStyle}
                value={ttsRate}
                onChange={e => setTtsRate(e.target.value)}
              >
                <option value="-20%">Slow</option>
                <option value="+0%">Normal</option>
                <option value="+15%">Fast</option>
                <option value="+30%">Very Fast</option>
              </select>
            </div>
          </>
        )}

        {ttsProvider === "elevenlabs" && (
          <>
            <p style={hintStyle}>
              Get your API key from <strong>elevenlabs.io/app/settings/api-keys</strong>
            </p>

            <input
              style={inputStyle}
              type="password"
              placeholder="ElevenLabs API Key (leave empty to keep existing)"
              value={elApiKey}
              onChange={e => setElApiKey(e.target.value)}
            />
            {ttsCfg?.elevenlabs?.has_api_key && (
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>
                API key configured
              </span>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Voice</span>
              {elVoicesLoading ? (
                <span style={{ fontSize: "12px", color: "var(--j-text-dim)" }}>Loading voices...</span>
              ) : elVoices.length > 0 ? (
                <select
                  style={inputStyle}
                  value={elVoiceId}
                  onChange={e => setElVoiceId(e.target.value)}
                >
                  <option value="">Default (Rachel)</option>
                  {elVoices.map(v => (
                    <option key={v.voice_id} value={v.voice_id}>
                      {v.name} ({v.category})
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: "12px", color: "var(--j-text-dim)" }}>
                  Save API key first, then voices will load
                </span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Model</span>
              <select
                style={inputStyle}
                value={elModel}
                onChange={e => setElModel(e.target.value)}
              >
                <option value="eleven_flash_v2_5">Flash v2.5 (Fast, low latency)</option>
                <option value="eleven_multilingual_v2">Multilingual v2 (Higher quality)</option>
              </select>
            </div>
          </>
        )}

        <button style={{ ...primaryBtnStyle, marginTop: "8px" }} onClick={saveTTS}>
          Save TTS Config
        </button>
      </div>
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      style={{
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

const cardStyle: React.CSSProperties = {
  padding: "20px",
  background: "var(--j-surface)",
  border: "1px solid var(--j-border)",
  borderRadius: "8px",
};

const headerStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "var(--j-text)",
  marginBottom: "16px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--j-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  marginBottom: "12px",
  paddingBottom: "12px",
  borderBottom: "1px solid var(--j-border)",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
};

const toggleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  cursor: "pointer",
};

const hintStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--j-text-dim)",
  margin: 0,
  lineHeight: 1.5,
};

const msgStyle: React.CSSProperties = {
  fontSize: "12px",
  marginBottom: "8px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--j-bg)",
  border: "1px solid var(--j-border)",
  borderRadius: "6px",
  color: "var(--j-text)",
  fontSize: "13px",
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "var(--j-accent)",
  color: "#000",
  border: "none",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};
