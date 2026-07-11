#pragma once
#include <optional>
#include <string>

#include "Config.hpp"

namespace PalKeeperMod
{
    // Cliente HTTP (WinHTTP) para a API interna do PalKeeper.
    //
    // IMPORTANTE: todos os métodos são BLOQUEANTES — chamar apenas a partir
    // da worker thread (ver JobQueue no PalKeeperMod.cpp), nunca da game
    // thread, ou o servidor congela durante pedidos lentos.
    class PalKeeperClient
    {
    public:
        explicit PalKeeperClient(const Config& config);

        // Devolve o corpo da resposta, ou std::nullopt em erro (já registado no log).
        std::optional<std::string> get(const std::string& path);
        std::optional<std::string> post(const std::string& path, const std::string& jsonBody);

    private:
        std::optional<std::string> request(const std::wstring& method, const std::string& path,
                                           const std::string* body);

        std::wstring m_host;
        int m_port = 8300;
        bool m_https = false;
        std::string m_token;
        int m_timeoutMs;
    };
}
