#include "ChatBridge.hpp"
#include "GameFunctions.hpp"

#include <cstdio>

#include <DynamicOutput/DynamicOutput.hpp>
#include <Unreal/FProperty.hpp>
#include <Unreal/FString.hpp>
#include <Unreal/Hooks.hpp>
#include <Unreal/UClass.hpp>
#include <Unreal/UFunction.hpp>
#include <Unreal/UObject.hpp>
#include <Unreal/UObjectGlobals.hpp>
#include <Unreal/UnrealCoreStructs.hpp>

namespace PalKeeperMod
{
    using namespace RC;
    using namespace RC::Unreal;
    using RC::Output::send;
    using enum RC::LogLevel::LogLevel;

    namespace
    {
        // Resolve o ponteiro de uma propriedade DO PARAM STRUCT por nome —
        // nunca por offset fixo, para sobreviver a mudanças de layout do jogo.
        template <typename T>
        T* paramPtr(UFunction* function, void* paramsBase, const CharType* propertyName)
        {
            if (!function || !paramsBase) return nullptr;
            const FProperty* property = function->FindProperty(FName(propertyName));
            if (!property) return nullptr;
            return reinterpret_cast<T*>(static_cast<uint8_t*>(paramsBase) + property->GetOffset_Internal());
        }

        std::string guidToHex(const FGuid& guid)
        {
            char buffer[40];
            std::snprintf(buffer, sizeof(buffer), "%08X%08X%08X%08X", guid.A, guid.B, guid.C, guid.D);
            return buffer;
        }

        FGuid hexToGuid(const std::string& hex)
        {
            FGuid guid{};
            if (hex.size() >= 32)
            {
                guid.A = (uint32_t)std::stoul(hex.substr(0, 8), nullptr, 16);
                guid.B = (uint32_t)std::stoul(hex.substr(8, 8), nullptr, 16);
                guid.C = (uint32_t)std::stoul(hex.substr(16, 8), nullptr, 16);
                guid.D = (uint32_t)std::stoul(hex.substr(24, 8), nullptr, 16);
            }
            return guid;
        }

        // O SendSystemToPlayerChat/SendSystemAnnounce são static BlueprintCallable
        // do PalUtility: precisam de um WorldContext vivo. Usamos qualquer
        // PalPlayerState como contexto.
        UObject* findWorldContext()
        {
            return UObjectGlobals::FindFirstOf(GameFunctions::PlayerStateClass);
        }

        ChatBridge::ChatHandler g_chatHandler;
    }

    bool ChatBridge::installChatHook(ChatHandler handler)
    {
        UFunction* chatFn =
            UObjectGlobals::StaticFindObject<UFunction*>(nullptr, nullptr, GameFunctions::ChatReceive);
        if (!chatFn)
        {
            send<Error>(STR("[PalKeeperMod] UFunction do chat não encontrada: {}\n"), GameFunctions::ChatReceive);
            send<Error>(STR("[PalKeeperMod] O 1.0 pode ter renomeado a função — corrige GameFunctions.hpp\n"));
            return false;
        }
        g_chatHandler = std::move(handler);

        UObjectGlobals::RegisterHook(
            GameFunctions::ChatReceive,
            [](UnrealScriptFunctionCallableContext& context, void*)
            {
                if (!g_chatHandler) return;
                UFunction* fn = context.TheStack.Node();
                void* params = context.TheStack.Locals();

                auto* messageProp = paramPtr<FString>(fn, params, GameFunctions::ChatProp_Message);
                auto* senderProp = paramPtr<FString>(fn, params, GameFunctions::ChatProp_Sender);
                auto* uidProp = paramPtr<FGuid>(fn, params, GameFunctions::ChatProp_SenderPlayerUid);
                auto* categoryProp = paramPtr<uint8_t>(fn, params, GameFunctions::ChatProp_Category);
                if (!messageProp) return; // layout inesperado — não tocar

                ChatMessage chat;
                chat.message = messageProp->GetCharArray();
                if (senderProp) chat.sender = senderProp->GetCharArray();
                if (uidProp) chat.senderUid = guidToHex(*uidProp);
                if (categoryProp) chat.category = *categoryProp;

                bool suppress = false;
                g_chatHandler(chat, suppress);

                // Reescrever os params (tags no nome; suprimir comandos)
                if (suppress)
                {
                    *messageProp = FString(STR(""));
                }
                else
                {
                    if (chat.message != messageProp->GetCharArray()) *messageProp = FString(chat.message.c_str());
                    if (senderProp && chat.sender != senderProp->GetCharArray())
                        *senderProp = FString(chat.sender.c_str());
                }
            },
            [](UnrealScriptFunctionCallableContext&, void*) {},
            nullptr);

        send<Verbose>(STR("[PalKeeperMod] hook de chat instalado em {}\n"), GameFunctions::ChatReceive);
        return true;
    }

    bool ChatBridge::sendAnnounce(const std::wstring& message)
    {
        UFunction* fn = UObjectGlobals::StaticFindObject<UFunction*>(nullptr, nullptr,
                                                                     GameFunctions::SendSystemAnnounce);
        UObject* defaultObj = UObjectGlobals::StaticFindObject<UObject*>(
            nullptr, nullptr, GameFunctions::PalUtilityClass);
        UObject* context = findWorldContext();
        if (!fn || !defaultObj || !context)
        {
            send<Warning>(STR("[PalKeeperMod] SendSystemAnnounce indisponível\n"));
            return false;
        }
        struct
        {
            UObject* WorldContextObject;
            FString Message;
        } params{context, FString(message.c_str())};
        defaultObj->ProcessEvent(fn, &params);
        return true;
    }

    bool ChatBridge::sendPlayerMessage(const std::string& playerUidHex, const std::wstring& message)
    {
        UFunction* fn = UObjectGlobals::StaticFindObject<UFunction*>(nullptr, nullptr,
                                                                     GameFunctions::SendSystemToPlayerChat);
        UObject* defaultObj = UObjectGlobals::StaticFindObject<UObject*>(
            nullptr, nullptr, GameFunctions::PalUtilityClass);
        UObject* context = findWorldContext();
        if (!fn || !defaultObj || !context)
        {
            send<Warning>(STR("[PalKeeperMod] SendSystemToPlayerChat indisponível\n"));
            return false;
        }
        struct
        {
            UObject* WorldContextObject;
            FString Message;
            FGuid PlayerUid;
        } params{context, FString(message.c_str()), hexToGuid(playerUidHex)};
        defaultObj->ProcessEvent(fn, &params);
        return true;
    }
}
