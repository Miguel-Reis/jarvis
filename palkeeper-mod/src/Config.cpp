#include "Config.hpp"

#include <filesystem>
#include <fstream>
#include <nlohmann/json.hpp>

namespace PalKeeperMod
{
    using nlohmann::json;

    Config Config::load(const std::wstring& modDirectory)
    {
        Config config;
        const auto path = std::filesystem::path(modDirectory) / "config.json";
        std::ifstream file(path);
        if (!file.is_open()) return config;

        json root = json::parse(file, nullptr, /*allow_exceptions=*/false);
        if (root.is_discarded() || !root.is_object()) return config;

        if (const auto& api = root["palkeeperApi"]; api.is_object())
        {
            config.apiUrl = api.value("url", config.apiUrl);
            config.apiToken = api.value("token", config.apiToken);
            config.apiTimeoutMs = api.value("timeoutMs", config.apiTimeoutMs);
        }
        if (const auto& commands = root["commands"]; commands.is_object())
        {
            config.commandPrefix = commands.value("prefix", config.commandPrefix);
            config.commandsEnabled = commands.value("enabled", config.commandsEnabled);
        }
        if (const auto& admins = root["adminSteamIds"]; admins.is_array())
        {
            for (const auto& id : admins)
                if (id.is_string()) config.adminSteamIds.insert(id.get<std::string>());
        }
        if (const auto& tags = root["tags"]; tags.is_object())
        {
            for (const auto& [steamId, tag] : tags.items())
                if (tag.is_string()) config.tags[steamId] = tag.get<std::string>();
        }
        if (const auto& welcome = root["welcome"]; welcome.is_object())
        {
            config.welcomeEnabled = welcome.value("enabled", config.welcomeEnabled);
            config.welcomeMessage = welcome.value("privateMessage", config.welcomeMessage);
            config.welcomeMessageFirst = welcome.value("privateMessageFirstVisit", config.welcomeMessageFirst);
        }
        if (const auto& messages = root["messages"]; messages.is_object())
        {
            for (const auto& [key, value] : messages.items())
                if (value.is_string()) config.messages[key] = value.get<std::string>();
        }
        return config;
    }
}
