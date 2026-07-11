// PalKeeperMod — mod C++ (UE4SS) que liga o chat do Palworld ao daemon PalKeeper.
//
// Arquitetura de threads (crítica para não congelar o servidor):
//   game thread  : hook do chat, envio de mensagens in-game (on_update)
//   worker thread: TODOS os pedidos HTTP ao PalKeeper
// As duas comunicam por filas protegidas por mutex.

#include <atomic>
#include <chrono>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <thread>

#include <DynamicOutput/DynamicOutput.hpp>
#include <Mod/CppUserModBase.hpp>
#include <nlohmann/json.hpp>

#include "ChatBridge.hpp"
#include "Config.hpp"
#include "PalKeeperClient.hpp"

namespace PalKeeperMod
{
    using namespace RC;
    using RC::Output::send;
    using enum RC::LogLevel::LogLevel;
    using nlohmann::json;

    namespace
    {
        std::string narrow(const std::wstring& value)
        {
            std::string out;
            out.reserve(value.size());
            for (wchar_t ch : value) out += ch < 128 ? (char)ch : '?';
            return out;
        }

        std::wstring widen(const std::string& value)
        {
            return {value.begin(), value.end()};
        }

        std::string replaceAll(std::string text, const std::string& from, const std::string& to)
        {
            size_t pos = 0;
            while ((pos = text.find(from, pos)) != std::string::npos)
            {
                text.replace(pos, from.size(), to);
                pos += to.size();
            }
            return text;
        }
    }

    class Mod final : public CppUserModBase
    {
    public:
        Mod()
        {
            ModName = STR("PalKeeperMod");
            ModVersion = STR("1.0.0");
            ModDescription = STR("Chat commands, tags e ponte para o daemon PalKeeper");
            ModAuthors = STR("PalKeeper");
        }

        ~Mod() override { stopWorker(); }

        void on_unreal_init() override
        {
            m_config = Config::load(STR("Mods/PalKeeperMod"));
            m_client = std::make_unique<PalKeeperClient>(m_config);
            startWorker();

            const bool hooked = m_bridge.installChatHook(
                [this](ChatMessage& chat, bool& suppress) { onChat(chat, suppress); });
            if (!hooked)
            {
                send<Error>(STR("[PalKeeperMod] chat indisponível — só welcome/announce vão funcionar\n"));
            }
            send<Default>(STR("[PalKeeperMod] iniciado (API PalKeeper em {})\n"),
                          widen(m_config.apiUrl));
        }

        // Corre na game thread a cada frame: esvazia as ações vindas da worker.
        void on_update() override
        {
            std::deque<std::function<void()>> actions;
            {
                std::scoped_lock lock(m_gameActionsMutex);
                std::swap(actions, m_gameActions);
            }
            for (auto& action : actions) action();
        }

    private:
        // ---------- chat (game thread) ----------

        void onChat(ChatMessage& chat, bool& suppress)
        {
            const std::string message = narrow(chat.message);

            // comandos
            if (m_config.commandsEnabled && message.rfind(m_config.commandPrefix, 0) == 0)
            {
                suppress = true; // o comando não aparece no chat público
                dispatchCommand(chat, message.substr(m_config.commandPrefix.size()));
                return;
            }

            // tags no nome (steamId resolvido pela cache alimentada pela worker)
            const std::string steamId = steamIdForUid(chat.senderUid);
            if (!steamId.empty())
            {
                auto tag = m_config.tags.find(steamId);
                if (tag != m_config.tags.end())
                {
                    chat.sender = widen(tag->second) + L" " + chat.sender;
                }
            }

            // relay do chat para o PalKeeper (log + Discord) — na worker
            json body{{"sender", narrow(chat.sender)},
                      {"playerUid", chat.senderUid},
                      {"steamId", steamId},
                      {"message", message},
                      {"category", chat.category}};
            enqueueWork([this, payload = body.dump()] { m_client->post("/mod/chat", payload); });
        }

        // ---------- comandos ----------

        void dispatchCommand(const ChatMessage& chat, const std::string& line)
        {
            std::istringstream stream(line);
            std::string command;
            stream >> command;
            std::string rest;
            std::getline(stream, rest);
            if (!rest.empty() && rest.front() == ' ') rest.erase(0, 1);

            const std::string uid = chat.senderUid;
            const std::string steamId = steamIdForUid(uid);
            const bool isAdmin = m_config.adminSteamIds.contains(steamId);

            if (command == "help")
            {
                reply(uid, m_config.message("help", "Comandos: !playtime, !leaderboard, !eventos, !ping"));
                if (isAdmin) reply(uid, m_config.message("helpAdmin", "Admin: !kick, !ban, !broadcast, !save"));
            }
            else if (command == "ping")
            {
                reply(uid, "Pong!");
            }
            else if (command == "playtime")
            {
                enqueueWork([this, uid] {
                    auto response = m_client->get("/mod/playtime/" + uid);
                    replyFromWorker(uid, response, [](const json& data) {
                        const int hours = data.value("playtimeSeconds", 0) / 3600;
                        const int minutes = data.value("playtimeSeconds", 0) % 3600 / 60;
                        return "Tempo de jogo: " + std::to_string(hours) + "h" + std::to_string(minutes) + "min";
                    });
                });
            }
            else if (command == "leaderboard" || command == "lb")
            {
                enqueueWork([this, uid] {
                    auto response = m_client->get("/mod/leaderboard");
                    replyFromWorker(uid, response, [](const json& data) {
                        std::string out = "Top playtime:";
                        int position = 1;
                        for (const auto& entry : data["entries"])
                        {
                            out += "\n" + std::to_string(position++) + ". " +
                                   entry.value("name", "?") + " - " +
                                   std::to_string(entry.value("playtimeSeconds", 0) / 3600) + "h";
                            if (position > 5) break;
                        }
                        return out;
                    });
                });
            }
            else if (command == "eventos" || command == "events")
            {
                enqueueWork([this, uid] {
                    auto response = m_client->get("/mod/events/active");
                    replyFromWorker(uid, response, [](const json& data) {
                        if (data["events"].empty()) return std::string("Sem eventos ativos.");
                        std::string out = "Eventos ativos:";
                        for (const auto& entry : data["events"]) out += "\n- " + entry.value("name", "?");
                        return out;
                    });
                });
            }
            else if (command == "broadcast" && requireAdmin(uid, isAdmin))
            {
                json body{{"message", rest}};
                enqueueWork([this, payload = body.dump()] { m_client->post("/actions/announce", payload); });
            }
            else if (command == "save" && requireAdmin(uid, isAdmin))
            {
                enqueueWork([this, uid] {
                    auto response = m_client->post("/actions/save", "{}");
                    queueReply(uid, response ? m_config.message("saved", "Mundo gravado.")
                                             : m_config.message("apiError", "Servico indisponivel."));
                });
            }
            else if (command == "kick" && requireAdmin(uid, isAdmin))
            {
                json body{{"steamId", firstWord(rest)}, {"message", "Kicked por um admin"}};
                enqueueWork([this, uid, payload = body.dump()] {
                    auto response = m_client->post("/actions/kick", payload);
                    queueReply(uid, response ? "Kick enviado." : m_config.message("apiError", "Erro."));
                });
            }
            else if (command == "ban" && requireAdmin(uid, isAdmin))
            {
                const std::string target = firstWord(rest);
                std::string reason = rest.size() > target.size() ? rest.substr(target.size() + 1) : "Banido por um admin";
                json body{{"steamId", target}, {"reason", reason}};
                enqueueWork([this, uid, payload = body.dump()] {
                    auto response = m_client->post("/bans", payload);
                    queueReply(uid, response ? "Ban aplicado e persistido." : m_config.message("apiError", "Erro."));
                });
            }
            else
            {
                reply(uid, m_config.message("unknownCommand", "Comando desconhecido. Escreve !help."));
            }
        }

        bool requireAdmin(const std::string& uid, bool isAdmin)
        {
            if (!isAdmin) reply(uid, m_config.message("noPermission", "Nao tens permissao."));
            return isAdmin;
        }

        static std::string firstWord(const std::string& text)
        {
            return text.substr(0, text.find(' '));
        }

        // ---------- respostas ----------

        // game thread → direto
        void reply(const std::string& uid, const std::string& message)
        {
            m_bridge.sendPlayerMessage(uid, widen(message));
        }

        // worker thread → enfileira para a game thread
        void queueReply(const std::string& uid, const std::string& message)
        {
            std::scoped_lock lock(m_gameActionsMutex);
            m_gameActions.push_back([this, uid, message] { reply(uid, message); });
        }

        void replyFromWorker(const std::string& uid, const std::optional<std::string>& response,
                             const std::function<std::string(const json&)>& format)
        {
            if (!response)
            {
                queueReply(uid, m_config.message("apiError", "Servico indisponivel, tenta mais tarde."));
                return;
            }
            json data = json::parse(*response, nullptr, false);
            if (data.is_discarded())
            {
                queueReply(uid, m_config.message("apiError", "Resposta invalida."));
                return;
            }
            queueReply(uid, format(data));
        }

        // ---------- worker thread ----------

        void startWorker()
        {
            m_running = true;
            m_worker = std::thread([this] {
                int ticks = 0;
                while (m_running)
                {
                    std::deque<std::function<void()>> work;
                    {
                        std::scoped_lock lock(m_workMutex);
                        std::swap(work, m_work);
                    }
                    for (auto& job : work) job();

                    // a cada ~5s: refrescar cache uid→steamId e ir buscar welcomes
                    if (++ticks % 25 == 0)
                    {
                        refreshPlayerCache();
                        if (m_config.welcomeEnabled) fetchPendingWelcomes();
                    }
                    std::this_thread::sleep_for(std::chrono::milliseconds(200));
                }
            });
        }

        void stopWorker()
        {
            m_running = false;
            if (m_worker.joinable()) m_worker.join();
        }

        void enqueueWork(std::function<void()> job)
        {
            std::scoped_lock lock(m_workMutex);
            m_work.push_back(std::move(job));
        }

        void refreshPlayerCache()
        {
            auto response = m_client->get("/players");
            if (!response) return;
            json data = json::parse(*response, nullptr, false);
            if (data.is_discarded()) return;
            std::scoped_lock lock(m_cacheMutex);
            for (const auto& player : data["players"])
            {
                const auto uid = player.value("playerId", "");
                const auto steamId = player.value("userId", "");
                if (!uid.empty() && !steamId.empty()) m_uidToSteam[uid] = steamId;
            }
        }

        std::string steamIdForUid(const std::string& uid)
        {
            std::scoped_lock lock(m_cacheMutex);
            auto it = m_uidToSteam.find(uid);
            return it != m_uidToSteam.end() ? it->second : std::string{};
        }

        // O PalKeeper deteta joins (polling REST) e enfileira boas-vindas; o mod
        // entrega-as como mensagem privada em vez de announce global.
        void fetchPendingWelcomes()
        {
            auto response = m_client->get("/mod/pending-welcomes");
            if (!response) return;
            json data = json::parse(*response, nullptr, false);
            if (data.is_discarded()) return;
            for (const auto& welcome : data["welcomes"])
            {
                const std::string uid = welcome.value("playerUid", "");
                const bool first = welcome.value("firstVisit", false);
                std::string message = first ? m_config.welcomeMessageFirst : m_config.welcomeMessage;
                message = replaceAll(message, "{name}", welcome.value("name", "jogador"));
                if (!uid.empty()) queueReply(uid, message);
            }
        }

        Config m_config;
        std::unique_ptr<PalKeeperClient> m_client;
        ChatBridge m_bridge;

        std::atomic<bool> m_running{false};
        std::thread m_worker;
        std::mutex m_workMutex;
        std::deque<std::function<void()>> m_work;

        std::mutex m_gameActionsMutex;
        std::deque<std::function<void()>> m_gameActions;

        std::mutex m_cacheMutex;
        std::map<std::string, std::string> m_uidToSteam;
    };
}

#define PALKEEPER_MOD_API __declspec(dllexport)
extern "C"
{
    PALKEEPER_MOD_API RC::CppUserModBase* start_mod()
    {
        return new PalKeeperMod::Mod();
    }

    PALKEEPER_MOD_API void uninstall_mod(RC::CppUserModBase* mod)
    {
        delete mod;
    }
}
