#pragma once
// =============================================================================
// TODOS os nomes de objetos/funções do Palworld usados pelo mod vivem AQUI.
//
// O Palworld 1.0 recompilou o executável e o suporte do UE4SS ainda está a
// estabilizar — se um hook falhar no arranque (vê o UE4SS.log), é quase de
// certeza um destes paths que mudou. Confirma com o Live View do UE4SS ou o
// dump de UFunctions e corrige apenas este ficheiro.
//
// Estes paths eram os corretos até à última versão pré-1.0 (usados por mods
// como o PalDefender):
// =============================================================================

namespace PalKeeperMod::GameFunctions
{
    // Recebida no servidor quando um jogador escreve no chat.
    // Assinatura conhecida: EnterChat_Receive(FPalChatMessage ChatMessage)
    inline constexpr auto ChatReceive = STR("/Script/Pal.PalPlayerState:EnterChat_Receive");

    // Envia uma mensagem de chat/sistema a TODOS (announce in-game).
    // UPalChatManager está acessível via PalUtility.
    inline constexpr auto SendSystemAnnounce = STR("/Script/Pal.PalUtility:SendSystemAnnounce");

    // Envia uma mensagem de sistema a UM jogador (mensagem "privada").
    // Assinatura conhecida: SendSystemToPlayerChat(UObject* WorldContext, FString Message, FGuid PlayerUid)
    inline constexpr auto SendSystemToPlayerChat = STR("/Script/Pal.PalUtility:SendSystemToPlayerChat");

    // Classe usada para resolver o WorldContext (primeira instância viva).
    inline constexpr auto PalUtilityClass = STR("/Script/Pal.PalUtility");
    inline constexpr auto PlayerStateClass = STR("/Script/Pal.PalPlayerState");

    // Propriedades lidas por NOME (com offsets resolvidos em runtime — nunca
    // por layout fixo de struct) da FPalChatMessage recebida no hook:
    inline constexpr auto ChatProp_Message = STR("Message");
    inline constexpr auto ChatProp_Sender = STR("Sender");
    inline constexpr auto ChatProp_SenderPlayerUid = STR("SenderPlayerUid");
    inline constexpr auto ChatProp_Category = STR("Category");

    // Propriedades do PalPlayerState para mapear jogador → SteamID/UID:
    inline constexpr auto PlayerStateProp_PlayerName = STR("PlayerNamePrivate");
}
