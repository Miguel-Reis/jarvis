#pragma once
#include <map>
#include <set>
#include <string>

namespace PalKeeperMod
{
    // Config carregada de ue4ss/Mods/PalKeeperMod/config.json (UTF-8).
    struct Config
    {
        std::string apiUrl = "http://127.0.0.1:8300";
        std::string apiToken;
        int apiTimeoutMs = 3000;

        std::string commandPrefix = "!";
        bool commandsEnabled = true;

        std::set<std::string> adminSteamIds;
        std::map<std::string, std::string> tags; // steamId → "[TAG]"

        bool welcomeEnabled = true;
        std::string welcomeMessage = "Bem-vindo, {name}!";
        std::string welcomeMessageFirst = "Bem-vindo pela primeira vez, {name}!";

        std::map<std::string, std::string> messages;

        std::string message(const std::string& key, const std::string& fallback) const
        {
            auto it = messages.find(key);
            return it != messages.end() ? it->second : fallback;
        }

        // Lê o config.json ao lado da DLL; devolve defaults se não existir.
        static Config load(const std::wstring& modDirectory);
    };
}
