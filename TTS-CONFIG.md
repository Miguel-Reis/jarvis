# Configuração TTS - Azure Speech (Recomendado)

## Por que Azure Speech?

- **Streaming real** com latência 100-300ms (vs 500ms-2s do Edge TTS)
- **Vozes excelentes em Português** (pt-PT e pt-BR)
- **Preço acessível**: ~€5/mês para uso moderado (primeiros 500k caracteres/mês grátis)

---

## Passo 1: Obter Chave da Azure Speech

1. Acede a: https://portal.azure.com
2. Cria um recurso "Speech Service"
3. Escolhe a região: **West Europe** (Portugal/Europa)
4. Copia a chave API e a região

**Preços:** https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/

---

## Passo 2: Configurar `~/.jarvis/config.yaml`

```yaml
tts:
  enabled: true
  provider: azure
  voice: pt-PT-DuarteNeural  # Voz masculina portuguesa
  # voice: pt-PT-RaquelNeural  # Voz feminina portuguesa
  # voice: pt-BR-AntonioNeural  # Voz masculina brasileira
  # voice: pt-BR-FranciscaNeural  # Voz feminina brasileira
  azure:
    api_key: "YOUR_AZURE_SPEECH_KEY_AQUI"
    region: westeurope
    output_format: audio-24khz-48kbitrate-mono-mp3
```

---

## Passo 3: Reiniciar o Daemon

```bash
pkill -f "bun.*daemon"
bun run start
```

---

## Passo 4: Testar

1. Abre o dashboard: http://localhost:3142/
2. Ativa TTS nas Settings > Channels
3. Pede ao Jarvis para falar algo
4. Deves ouvir voz portuguesa fluente e rápida

---

## Providers Alternativos

### ElevenLabs (Qualidade Superior)

```yaml
tts:
  enabled: true
  provider: elevenlabs
  voice: CwhRBWXzGAHq8TQ4Fs17  # Voz configurada
  elevenlabs:
    api_key: "sk_..."
    model: eleven_flash_v2_5  # Modelo rápido
```

**Prós:** Qualidade mais natural, vozes únicas
**Contras:** Mais caro, latência ligeiramente maior

---

### Google Cloud TTS

```yaml
tts:
  enabled: true
  provider: google
  voice: pt-PT-Standard-C
  google:
    api_key: "YOUR_GOOGLE_API_KEY"
    language_code: pt-PT
```

**Prós:** Qualidade WaveNet excelente
**Contras:** Setup mais complexo (service account JSON)

---

### OpenAI TTS

```yaml
tts:
  enabled: true
  provider: openai
  voice: alloy  # ou echo, fable, onyx, nova, shimmer
  openai:
    api_key: "sk-..."
    model: tts-1  # ou tts-1-hd (melhor, mais lento)
```

**Prós:** Setup fácil, preço baixo ($15/mês crédito)
**Contras:** Apenas 6 vozes, menos natural

---

### Edge TTS (Grátis)

```yaml
tts:
  enabled: true
  provider: edge
  voice: pt-PT-DuarteNeural
  rate: +0%
  volume: +0%
```

**Prós:** Grátis, sem API key
**Contras:** Lento (500ms-2s), não é streaming real

---

## Vozes Disponíveis

### Português (Portugal)
- `pt-PT-DuarteNeural` (masculina)
- `pt-PT-RaquelNeural` (feminina)

### Português (Brasil)
- `pt-BR-AntonioNeural` (masculina)
- `pt-BR-FranciscaNeural` (feminina)

### Inglês
- `en-US-AndrewNeural`, `en-US-AriaNeural`, `en-US-GuyNeural`, etc.

**Lista completa:** https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts

---

## Troubleshooting

### TTS não funciona
1. Verifica se `enabled: true` no config
2. Verifica se a API key está correta
3. Testa no dashboard: Settings > Channels > TTS

### Latência alta
1. Usa região mais próxima: `westeurope` para Portugal
2. Usa `eleven_flash_v2_5` em vez de `eleven_multilingual_v2`
3. Verifica conexão de internet

### Áudio cortado
1. Aumenta `output_format` bitrate
2. Verifica se o WebSocket está estável
3. Testa com frases mais curtas
