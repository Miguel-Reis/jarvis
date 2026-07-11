#pragma once
#include <functional>
#include <string>

namespace PalKeeperMod
{
    struct ChatMessage
    {
        std::wstring message;
        std::wstring sender;
        std::string senderUid; // FGuid em hex (PlayerUID do Palworld)
        int category = 0;
    };

    // Ponte para o mundo do jogo: hook do chat + envio de mensagens.
    // TODAS as chamadas têm de acontecer na game thread (hooks e on_update).
    class ChatBridge
    {
    public:
        using ChatHandler = std::function<void(ChatMessage&, bool& suppress)>;

        // Regista o hook em PalPlayerState::EnterChat_Receive. Devolve false
        // (com log claro) se a função não existir — ver GameFunctions.hpp.
        bool installChatHook(ChatHandler handler);

        // Announce global in-game (equivalente ao announce da REST API).
        bool sendAnnounce(const std::wstring& message);

        // Mensagem de sistema dirigida a um jogador (pelo PlayerUID em hex).
        bool sendPlayerMessage(const std::string& playerUidHex, const std::wstring& message);
    };
}
