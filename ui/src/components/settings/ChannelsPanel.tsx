import { useState, useEffect } from "react";
import { useApiData, api } from "../../hooks/useApi";
import { validatePhoneNumber, validateUrl, validateTelegramToken, validateDiscordToken } from "../../lib/validators";

type ChannelStatusData = {
  channels: Record<string, boolean>;
  stt: string | null;
};

type ChannelConfigData = {
  telegram: { enabled: boolean; has_token: boolean; allowed_users: number[] };
  discord: { enabled: boolean; has_token: boolean; allowed_users: string[]; guild_id: string | null };
  whatsapp: { enabled: boolean; has_phone_number_id: boolean; has_access_token: boolean; has_verify_token: boolean; allowed_users: string[] };
  signal: { enabled: boolean; phone: string; api_url: string; allowed_senders: string[] };
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
  azure: {
    has_api_key: boolean;
    region: string;
    output_format: string;
  } | null;
  google: {
    has_api_key: boolean;
    language_code: string;
  } | null;
  openai: {
    has_api_key: boolean;
    model: string;
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

  // Signal form
  const [sigEnabled, setSigEnabled] = useState(false);
  const [sigPhone, setSigPhone] = useState("");
  const [sigApiUrl, setSigApiUrl] = useState("http://localhost:8080");
  const [sigAllowed, setSigAllowed] = useState("");

  // STT form
  const [sttProvider, setSttProvider] = useState("openai");
  const [sttKey, setSttKey] = useState("");
  const [sttEndpoint, setSttEndpoint] = useState("http://localhost:8080");
  const [sttServerType, setSttServerType] = useState("whisper_cpp");

  // TTS form
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsProvider, setTtsProvider] = useState("azure");
  const [ttsVoice, setTtsVoice] = useState("pt-PT-DuarteNeural");
  const [ttsRate, setTtsRate] = useState("+0%");
  // ElevenLabs
  const [elApiKey, setElApiKey] = useState("");
  const [elVoiceId, setElVoiceId] = useState("");
  const [elModel, setElModel] = useState("eleven_flash_v2_5");
  const [elVoices, setElVoices] = useState<ElevenLabsVoice[]>([]);
  const [elVoicesLoading, setElVoicesLoading] = useState(false);
  // Azure
  const [azureApiKey, setAzureApiKey] = useState("");
  const [azureRegion, setAzureRegion] = useState("westeurope");
  // Google
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [googleLanguage, setGoogleLanguage] = useState("pt-PT");
  // OpenAI
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("tts-1");
  const [openaiVoice, setOpenaiVoice] = useState("alloy");

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
      if (channelCfg.signal) {
        setSigEnabled(channelCfg.signal.enabled);
        setSigPhone(channelCfg.signal.phone ?? "");
        setSigApiUrl(channelCfg.signal.api_url ?? "http://localhost:8080");
        setSigAllowed(channelCfg.signal.allowed_senders.join(", "));
      }
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
      setTtsProvider(ttsCfg.provider || "azure");
      setTtsVoice(ttsCfg.voice || "pt-PT-DuarteNeural");
      setTtsRate(ttsCfg.rate);
      if (ttsCfg.elevenlabs) {
        setElVoiceId(ttsCfg.elevenlabs.voice_id ?? "");
        setElModel(ttsCfg.elevenlabs.model);
      }
      if (ttsCfg.azure) {
        setAzureRegion(ttsCfg.azure.region || "westeurope");
      }
      if (ttsCfg.google) {
        setGoogleLanguage(ttsCfg.google.language_code || "pt-PT");
      }
      if (ttsCfg.openai) {
        setOpenaiModel(ttsCfg.openai.model || "tts-1");
        setOpenaiVoice((ttsCfg.openai as any).voice || "alloy");
      }
    }
  }, [ttsCfg]);

  // Fetch voices when provider changes
  useEffect(() => {
    let cancelled = false;
    const fetchVoices = async () => {
      if (ttsProvider === "edge") {
        setEdgeVoicesLoading(true);
        try {
          const voices = await api<{ voice_id: string; name: string; locale: string }[]>("/api/tts/voices?provider=edge&lang=all");
          if (!cancelled) setEdgeVoices(voices);
        } catch {}
        finally {
          if (!cancelled) setEdgeVoicesLoading(false);
        }
      } else if (ttsProvider === "elevenlabs" && ttsCfg?.elevenlabs?.has_api_key) {
        setElVoicesLoading(true);
        try {
          const voices = await api<ElevenLabsVoice[]>("/api/tts/voices?provider=elevenlabs");
          if (!cancelled) setElVoices(voices);
        } catch {}
        finally {
          if (!cancelled) setElVoicesLoading(false);
        }
      }
    };
    fetchVoices();
    return () => { cancelled = true; };
  }, [ttsProvider, ttsCfg?.elevenlabs?.has_api_key]);

  const saveChannels = async () => {
    try {
      const body: Record<string, unknown> = {};

      // Validate Telegram token if enabled and token provided
      if (tgEnabled && tgToken) {
        const tgResult = validateTelegramToken(tgToken);
        if (!tgResult.valid) {
          setMsg({ text: tgResult.error!, type: "error" });
          return;
        }
      }

      // Validate Discord token if enabled and token provided
      if (dcEnabled && dcToken) {
        const dcResult = validateDiscordToken(dcToken);
        if (!dcResult.valid) {
          setMsg({ text: dcResult.error!, type: "error" });
          return;
        }
      }

      // Validate Signal phone if enabled
      if (sigEnabled && sigPhone) {
        const sigResult = validatePhoneNumber(sigPhone.trim());
        if (!sigResult.valid) {
          setMsg({ text: sigResult.error!, type: "error" });
          return;
        }
      }

      // Validate Signal API URL if provided
      if (sigApiUrl && sigApiUrl !== "http://localhost:8080") {
        const urlResult = validateUrl(sigApiUrl.trim(), "Signal API URL");
        if (!urlResult.valid) {
          setMsg({ text: urlResult.error!, type: "error" });
          return;
        }
      }

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

      body.signal = {
        enabled: sigEnabled,
        phone: sigPhone.trim(),
        api_url: sigApiUrl.trim() || "http://localhost:8080",
        allowed_senders: sigAllowed.split(",").map(s => s.trim()).filter(Boolean),
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

      // Validate API key length
      if ((sttProvider === "openai" || sttProvider === "groq") && sttKey) {
        if (sttKey.length < 8) {
          setMsg({ text: "API key must be at least 8 characters", type: "error" });
          return;
        }
        body[sttProvider] = { api_key: sttKey };
      }

      // Validate local endpoint URL
      if (sttProvider === "local" && sttEndpoint) {
        const urlResult = validateUrl(sttEndpoint.trim(), "Whisper endpoint");
        if (!urlResult.valid) {
          setMsg({ text: urlResult.error!, type: "error" });
          return;
        }
        body.local = { endpoint: sttEndpoint.trim(), server_type: sttServerType };
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

  const testSTT = async () => {
    try {
      const body: Record<string, unknown> = { provider: sttProvider };
      if (sttProvider === "openai" && sttKey) body.api_key = sttKey;
      if (sttProvider === "groq" && sttKey) body.api_key = sttKey;
      if (sttProvider === "local") body.endpoint = sttEndpoint;

      const result = await api<{ ok: boolean; message: string }>("/api/config/stt/test", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setMsg({ text: result.message, type: result.ok ? "success" : "error" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "STT test failed", type: "error" });
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

      // Validate API keys before saving
      if (ttsProvider === "elevenlabs" && elApiKey) {
        if (elApiKey.length < 8) {
          setMsg({ text: "ElevenLabs API key must be at least 8 characters", type: "error" });
          return;
        }
        body.elevenlabs = {
          ...(elApiKey ? { api_key: elApiKey } : {}),
          voice_id: elVoiceId || undefined,
          model: elModel,
        };
      } else if (ttsProvider === "azure" && azureApiKey) {
        if (azureApiKey.length < 8) {
          setMsg({ text: "Azure API key must be at least 8 characters", type: "error" });
          return;
        }
        body.azure = {
          ...(azureApiKey ? { api_key: azureApiKey } : {}),
          region: azureRegion,
          output_format: "audio-24khz-48kbitrate-mono-mp3",
        };
      } else if (ttsProvider === "google" && googleApiKey) {
        if (googleApiKey.length < 8) {
          setMsg({ text: "Google Cloud API key must be at least 8 characters", type: "error" });
          return;
        }
        body.google = {
          ...(googleApiKey ? { api_key: googleApiKey } : {}),
          language_code: googleLanguage,
        };
      } else if (ttsProvider === "openai" && openaiApiKey) {
        if (openaiApiKey.length < 8) {
          setMsg({ text: "OpenAI API key must be at least 8 characters", type: "error" });
          return;
        }
        body.openai = {
          ...(openaiApiKey ? { api_key: openaiApiKey } : {}),
          model: openaiModel,
          voice: openaiVoice,
        };
      }

      await api("/api/config/tts", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setElApiKey("");
      setAzureApiKey("");
      setGoogleApiKey("");
      setOpenaiApiKey("");
      setMsg({ text: "TTS config saved and applied.", type: "success" });
      refetchTts();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to save", type: "error" });
    }
  };

  const testTTS = async () => {
    try {
      const body: Record<string, unknown> = { provider: ttsProvider };
      if (ttsProvider === "elevenlabs" && elApiKey) body.api_key = elApiKey;
      if (ttsProvider === "azure" && azureApiKey) {
        body.api_key = azureApiKey;
        body.region = azureRegion;
      }
      if (ttsProvider === "google" && googleApiKey) body.api_key = googleApiKey;
      if (ttsProvider === "openai" && openaiApiKey) body.api_key = openaiApiKey;

      const result = await api<{ ok: boolean; message: string }>("/api/config/tts/test", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setMsg({ text: result.message, type: result.ok ? "success" : "error" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "TTS test failed", type: "error" });
    }
  };

  const testChannel = async (channel: string, extraBody?: Record<string, unknown>) => {
    try {
      const body: Record<string, unknown> = { channel };
      if (channel === "telegram" && tgToken) body.token = tgToken;
      if (channel === "discord" && dcToken) body.token = dcToken;
      if (channel === "whatsapp") {
        if (waPhoneNumberId) body.phone_number_id = waPhoneNumberId;
        if (waAccessToken) body.access_token = waAccessToken;
      }
      if (channel === "signal" && sigPhone) body.phone = sigPhone;

      if (extraBody) Object.assign(body, extraBody);

      const result = await api<{ ok: boolean; message: string }>("/api/config/channels/test", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setMsg({ text: result.message, type: result.ok ? "success" : "error" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : `${channel} test failed`, type: "error" });
    }
  };

  return (
    <div className="sp-card">
      <h3 className="sp-card-title">Communication Channels</h3>

      {msg && (
        <div className={`sp-msg ${msg.type === "error" ? "sp-msg--error" : "sp-msg--success"}`} style={{ marginBottom: "8px" }}>
          {msg.text}
        </div>
      )}

      {/* Voice Activation Section */}
      <div className="sp-section">
        <div className="sp-label">Voice Activation</div>
        <p className="sp-hint">
          When enabled, JARVIS listens for <strong>"Hey Jarvis"</strong> to start recording.
          Disable if you prefer push-to-talk (microphone button in chat) or want to save CPU.
        </p>
        <label className="sp-toggle-row">
          <input
            type="checkbox"
            checked={wakeWordEnabled}
            onChange={e => handleWakeWordToggle(e.target.checked)}
          />
          <span style={{ fontSize: "13px", color: "var(--j-text)" }}>Enable wake word detection</span>
        </label>
      </div>

      {/* Telegram Section */}
      <div className="sp-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="sp-label">Telegram</div>
          <div className="sp-row">
            <StatusDot color={status?.channels.telegram ? "var(--j-success)" : "var(--j-text-muted)"} />
            <span style={{ fontSize: "11px", color: "var(--j-text-dim)" }}>
              {status?.channels.telegram ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        <p className="sp-hint">
          Create a bot via <strong>@BotFather</strong> on Telegram, then paste the token here.
        </p>

        <label className="sp-toggle-row">
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
          className="sp-input"
          type="password"
          placeholder="Bot Token (leave empty to keep existing)"
          value={tgToken}
          onChange={e => setTgToken(e.target.value)}
        />
        <input
          className="sp-input"
          type="text"
          placeholder="Allowed User IDs (comma-separated, empty = all)"
          value={tgAllowed}
          onChange={e => setTgAllowed(e.target.value)}
        />
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button className="sp-btn-secondary" onClick={() => testChannel("telegram")} style={{ fontSize: "12px", padding: "6px 12px" }}>
            Test Telegram Bot
          </button>
        </div>
      </div>

      {/* Discord Section */}
      <div className="sp-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="sp-label">Discord</div>
          <div className="sp-row">
            <StatusDot color={status?.channels.discord ? "var(--j-success)" : "var(--j-text-muted)"} />
            <span style={{ fontSize: "11px", color: "var(--j-text-dim)" }}>
              {status?.channels.discord ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        <p className="sp-hint">
          Create an app at <strong>discord.com/developers</strong>, add a Bot, copy the token.
          Enable <em>Message Content Intent</em> in Bot settings.
        </p>

        <label className="sp-toggle-row">
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
          className="sp-input"
          type="password"
          placeholder="Bot Token (leave empty to keep existing)"
          value={dcToken}
          onChange={e => setDcToken(e.target.value)}
        />
        <input
          className="sp-input"
          type="text"
          placeholder="Allowed User IDs (comma-separated, empty = all)"
          value={dcAllowed}
          onChange={e => setDcAllowed(e.target.value)}
        />
        <input
          className="sp-input"
          type="text"
          placeholder="Guild ID (optional, restrict to one server)"
          value={dcGuild}
          onChange={e => setDcGuild(e.target.value)}
        />
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button className="sp-btn-secondary" onClick={() => testChannel("discord")} style={{ fontSize: "12px", padding: "6px 12px" }}>
            Test Discord Bot
          </button>
        </div>
      </div>

      {/* WhatsApp Section */}
      <div className="sp-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="sp-label">WhatsApp</div>
          <div className="sp-row">
            <StatusDot color={status?.channels.whatsapp ? "var(--j-success)" : "var(--j-text-muted)"} />
            <span style={{ fontSize: "11px", color: "var(--j-text-dim)" }}>
              {status?.channels.whatsapp ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        <p className="sp-hint">
          Requires a <strong>Meta Business account</strong> with a WhatsApp Cloud API app.
          Set the webhook URL to <code style={{ fontSize: "11px", background: "var(--j-bg)", padding: "1px 4px", borderRadius: "3px" }}>https://your-domain/webhooks/whatsapp</code>.
        </p>

        <label className="sp-toggle-row">
          <input
            type="checkbox"
            checked={waEnabled}
            onChange={e => setWaEnabled(e.target.checked)}
          />
          <span style={{ fontSize: "13px", color: "var(--j-text)" }}>Enabled</span>
        </label>

        <input
          className="sp-input"
          type="text"
          placeholder={`Phone Number ID${channelCfg?.whatsapp.has_phone_number_id ? " (configured)" : ""}`}
          value={waPhoneNumberId}
          onChange={e => setWaPhoneNumberId(e.target.value)}
        />
        <input
          className="sp-input"
          type="password"
          placeholder={`System User Access Token${channelCfg?.whatsapp.has_access_token ? " (configured)" : ""}`}
          value={waAccessToken}
          onChange={e => setWaAccessToken(e.target.value)}
        />
        <input
          className="sp-input"
          type="text"
          placeholder={`Webhook Verify Token${channelCfg?.whatsapp.has_verify_token ? " (configured)" : ""}`}
          value={waVerifyToken}
          onChange={e => setWaVerifyToken(e.target.value)}
        />
        <input
          className="sp-input"
          type="text"
          placeholder="Allowed phone numbers in E.164 format (comma-separated, empty = all)"
          value={waAllowed}
          onChange={e => setWaAllowed(e.target.value)}
        />
      </div>

      {/* Signal section */}
      <div className="sp-section" style={{ marginTop: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="sp-label">
            Signal
            <StatusDot color={status?.channels.signal ? "var(--j-success)" : "var(--j-text-muted)"} />
            <span style={{ fontSize: "10px", color: status?.channels.signal ? "var(--j-success)" : "var(--j-text-muted)", marginLeft: "4px" }}>
              {status?.channels.signal ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>
        <p className="sp-hint">
          Requires <code style={{ fontSize: "11px", background: "var(--j-bg)", padding: "1px 4px", borderRadius: "3px" }}>signal-cli</code> running as a REST daemon.{" "}
          Start with: <code style={{ fontSize: "11px", background: "var(--j-bg)", padding: "1px 4px", borderRadius: "3px" }}>signal-cli -a +NUMBER daemon --http --port 8080</code>
        </p>
        <label className="sp-toggle-row">
          <input type="checkbox" className="sp-toggle" checked={sigEnabled} onChange={e => setSigEnabled(e.target.checked)} />
          Enable Signal
        </label>
        <input
          className="sp-input"
          type="text"
          placeholder="Your Signal number in E.164 format (e.g. +351912345678)"
          value={sigPhone}
          onChange={e => setSigPhone(e.target.value)}
        />
        <input
          className="sp-input"
          type="text"
          placeholder="signal-cli API URL (default: http://localhost:8080)"
          value={sigApiUrl}
          onChange={e => setSigApiUrl(e.target.value)}
        />
        <input
          className="sp-input"
          type="text"
          placeholder="Allowed senders in E.164 format (comma-separated, empty = all)"
          value={sigAllowed}
          onChange={e => setSigAllowed(e.target.value)}
        />
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button className="sp-btn-secondary" onClick={() => testChannel("signal")} style={{ fontSize: "12px", padding: "6px 12px" }}>
            Test Signal Connection
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
        <button className="sp-btn-primary" onClick={saveChannels}>
          Save Channel Config
        </button>
        <button className="sp-btn-secondary" onClick={() => testChannel("telegram")} style={{ fontSize: "12px", padding: "6px 12px" }}>
          Test All Channels
        </button>
      </div>

      {/* STT Section */}
      <div className="sp-section" style={{ marginTop: "16px" }}>
        <div className="sp-label">Voice Transcription (STT)</div>
        <p className="sp-hint">
          Enables voice message transcription on Telegram and Discord.
          Provide an API key for the selected provider.
        </p>

        <select
          className="sp-select"
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
              className="sp-input"
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
              className="sp-input"
              type="text"
              placeholder="Whisper endpoint (e.g., http://localhost:8080)"
              value={sttEndpoint}
              onChange={e => setSttEndpoint(e.target.value)}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Server Type</span>
              <select
                className="sp-select"
                value={sttServerType}
                onChange={e => setSttServerType(e.target.value)}
              >
                <option value="whisper_cpp">whisper.cpp</option>
                <option value="openai_compatible">OpenAI-compatible</option>
              </select>
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button className="sp-btn-primary" onClick={saveSTT}>
            Save STT Config
          </button>
          <button className="sp-btn-secondary" onClick={testSTT} style={{ borderColor: "var(--j-primary)", color: "var(--j-primary)" }}>
            Test Connection
          </button>
        </div>
      </div>

      {/* TTS Section */}
      <div className="sp-section-last" style={{ marginTop: "16px" }}>
        <div className="sp-label">Text-to-Speech (TTS)</div>
        <p className="sp-hint">
          Enables voice responses from JARVIS via the dashboard.
        </p>

        <label className="sp-toggle-row">
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
            className="sp-select"
            value={ttsProvider}
            onChange={e => setTtsProvider(e.target.value)}
          >
            <option value="azure">Azure Speech (Recommended - Low Latency)</option>
            <option value="elevenlabs">ElevenLabs (Premium Quality)</option>
            <option value="google">Google Cloud TTS (WaveNet)</option>
            <option value="openai">OpenAI TTS (Simple, Affordable)</option>
            <option value="edge">Edge TTS (Free, No API Key)</option>
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
                  className="sp-select"
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
                className="sp-select"
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
            <p className="sp-hint">
              Get your API key from <strong>elevenlabs.io/app/settings/api-keys</strong>
            </p>

            <input
              className="sp-input"
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
                  className="sp-select"
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
                className="sp-select"
                value={elModel}
                onChange={e => setElModel(e.target.value)}
              >
                <option value="eleven_flash_v2_5">Flash v2.5 (Fast, low latency)</option>
                <option value="eleven_multilingual_v2">Multilingual v2 (Higher quality)</option>
              </select>
            </div>
          </>
        )}

        {ttsProvider === "azure" && (
          <>
            <p className="sp-hint">
              Get your API key from <strong>portal.azure.com</strong> → Create "Speech Service" → West Europe region.
              First 500k characters/month free (~€5/month for moderate use).
            </p>

            <input
              className="sp-input"
              type="password"
              placeholder="Azure Speech API Key (leave empty to keep existing)"
              value={azureApiKey}
              onChange={e => setAzureApiKey(e.target.value)}
            />
            {ttsCfg?.azure?.has_api_key && (
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>
                API key configured
              </span>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Region</span>
              <select
                className="sp-select"
                value={azureRegion}
                onChange={e => setAzureRegion(e.target.value)}
              >
                <option value="westeurope">West Europe (Recommended for Portugal)</option>
                <option value="eastus">East US</option>
                <option value="westus">West US</option>
                <option value="eastus2">East US 2</option>
                <option value="westus2">West US 2</option>
                <option value="northeurope">North Europe</option>
                <option value="uksouth">UK South</option>
                <option value="japaneast">Japan East</option>
                <option value="australiaeast">Australia East</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Voice</span>
              <select
                className="sp-select"
                value={ttsVoice}
                onChange={e => setTtsVoice(e.target.value)}
              >
                <optgroup label="Portuguese (Portugal)">
                  <option value="pt-PT-DuarteNeural">Duarte (Male)</option>
                  <option value="pt-PT-RaquelNeural">Raquel (Female)</option>
                </optgroup>
                <optgroup label="Portuguese (Brazil)">
                  <option value="pt-BR-AntonioNeural">Antonio (Male)</option>
                  <option value="pt-BR-FranciscaNeural">Francisca (Female)</option>
                </optgroup>
                <optgroup label="English (US)">
                  <option value="en-US-AndrewNeural">Andrew (Male)</option>
                  <option value="en-US-AriaNeural">Aria (Female)</option>
                  <option value="en-US-GuyNeural">Guy (Male)</option>
                  <option value="en-US-JennyNeural">Jenny (Female)</option>
                </optgroup>
                <optgroup label="English (UK)">
                  <option value="en-GB-RyanNeural">Ryan (Male)</option>
                  <option value="en-GB-SoniaNeural">Sonia (Female)</option>
                </optgroup>
              </select>
            </div>
          </>
        )}

        {ttsProvider === "google" && (
          <>
            <p className="sp-hint">
              Get your API key from <strong>console.cloud.google.com</strong> → Text-to-Speech API.
              Excellent WaveNet quality, first 1M characters/month free.
            </p>

            <input
              className="sp-input"
              type="password"
              placeholder="Google Cloud API Key (leave empty to keep existing)"
              value={googleApiKey}
              onChange={e => setGoogleApiKey(e.target.value)}
            />
            {ttsCfg?.google?.has_api_key && (
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>
                API key configured
              </span>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Language Code</span>
              <select
                className="sp-select"
                value={googleLanguage}
                onChange={e => setGoogleLanguage(e.target.value)}
              >
                <option value="pt-PT">Portuguese (Portugal)</option>
                <option value="pt-BR">Portuguese (Brazil)</option>
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="es-ES">Spanish (Spain)</option>
                <option value="fr-FR">French (France)</option>
                <option value="de-DE">German (Germany)</option>
                <option value="it-IT">Italian (Italy)</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Voice</span>
              <select
                className="sp-select"
                value={ttsVoice}
                onChange={e => setTtsVoice(e.target.value)}
              >
                <optgroup label="Portuguese (Portugal)">
                  <option value="pt-PT-Standard-C">Standard C (Female)</option>
                  <option value="pt-PT-Standard-D">Standard D (Male)</option>
                  <option value="pt-PT-Wavenet-C">WaveNet C (Female, Premium)</option>
                  <option value="pt-PT-Wavenet-D">WaveNet D (Male, Premium)</option>
                </optgroup>
                <optgroup label="Portuguese (Brazil)">
                  <option value="pt-BR-Standard-A">Standard A (Female)</option>
                  <option value="pt-BR-Standard-B">Standard B (Male)</option>
                  <option value="pt-BR-Wavenet-A">WaveNet A (Female, Premium)</option>
                  <option value="pt-BR-Wavenet-B">WaveNet B (Male, Premium)</option>
                </optgroup>
                <optgroup label="English (US)">
                  <option value="en-US-Standard-A">Standard A (Female)</option>
                  <option value="en-US-Standard-B">Standard B (Male)</option>
                  <option value="en-US-Wavenet-A">WaveNet A (Female, Premium)</option>
                  <option value="en-US-Wavenet-B">WaveNet B (Male, Premium)</option>
                </optgroup>
              </select>
            </div>
          </>
        )}

        {ttsProvider === "openai" && (
          <>
            <p className="sp-hint">
              Get your API key from <strong>platform.openai.com/api-keys</strong>.
              Simple setup, affordable pricing ($15 per 1M characters).
            </p>

            <input
              className="sp-input"
              type="password"
              placeholder="OpenAI API Key (leave empty to keep existing)"
              value={openaiApiKey}
              onChange={e => setOpenaiApiKey(e.target.value)}
            />
            {ttsCfg?.openai?.has_api_key && (
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>
                API key configured
              </span>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Model</span>
              <select
                className="sp-select"
                value={openaiModel}
                onChange={e => setOpenaiModel(e.target.value)}
              >
                <option value="tts-1">TTS-1 (Faster, lower cost)</option>
                <option value="tts-1-hd">TTS-1-HD (Higher quality, slower)</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>Voice</span>
              <select
                className="sp-select"
                value={openaiVoice}
                onChange={e => setOpenaiVoice(e.target.value)}
              >
                <option value="alloy">Alloy (Neutral)</option>
                <option value="echo">Echo (Male)</option>
                <option value="fable">Fable (Male, British)</option>
                <option value="onyx">Onyx (Male, Deep)</option>
                <option value="nova">Nova (Female, Warm)</option>
                <option value="shimmer">Shimmer (Female, Soft)</option>
              </select>
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button className="sp-btn-primary" onClick={saveTTS}>
            Save TTS Config
          </button>
          <button className="sp-btn-secondary" onClick={testTTS} style={{ borderColor: "var(--j-primary)", color: "var(--j-primary)" }}>
            Test Connection
          </button>
        </div>
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

