#include "PalKeeperClient.hpp"

#include <Windows.h>
#include <winhttp.h>

#include <DynamicOutput/DynamicOutput.hpp>

namespace PalKeeperMod
{
    using RC::Output::send;
    using RC::LogLevel::Warning;

    namespace
    {
        std::wstring widen(const std::string& value)
        {
            if (value.empty()) return {};
            const int size = MultiByteToWideChar(CP_UTF8, 0, value.data(), (int)value.size(), nullptr, 0);
            std::wstring out(size, L'\0');
            MultiByteToWideChar(CP_UTF8, 0, value.data(), (int)value.size(), out.data(), size);
            return out;
        }
    }

    PalKeeperClient::PalKeeperClient(const Config& config)
        : m_token(config.apiToken), m_timeoutMs(config.apiTimeoutMs)
    {
        // parse mínimo de http(s)://host:porta
        std::string url = config.apiUrl;
        m_https = url.rfind("https://", 0) == 0;
        url = url.substr(url.find("://") + 3);
        const auto slash = url.find('/');
        if (slash != std::string::npos) url = url.substr(0, slash);
        const auto colon = url.find(':');
        if (colon != std::string::npos)
        {
            m_port = std::stoi(url.substr(colon + 1));
            url = url.substr(0, colon);
        }
        else
        {
            m_port = m_https ? 443 : 80;
        }
        m_host = widen(url);
    }

    std::optional<std::string> PalKeeperClient::get(const std::string& path)
    {
        return request(L"GET", path, nullptr);
    }

    std::optional<std::string> PalKeeperClient::post(const std::string& path, const std::string& jsonBody)
    {
        return request(L"POST", path, &jsonBody);
    }

    std::optional<std::string> PalKeeperClient::request(const std::wstring& method, const std::string& path,
                                                        const std::string* body)
    {
        const HINTERNET session = WinHttpOpen(L"PalKeeperMod/1.0", WINHTTP_ACCESS_TYPE_NO_PROXY,
                                              WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        if (!session) return std::nullopt;

        WinHttpSetTimeouts(session, m_timeoutMs, m_timeoutMs, m_timeoutMs, m_timeoutMs);

        std::optional<std::string> result;
        const HINTERNET connect = WinHttpConnect(session, m_host.c_str(), (INTERNET_PORT)m_port, 0);
        if (connect)
        {
            const HINTERNET req = WinHttpOpenRequest(connect, method.c_str(), widen(path).c_str(), nullptr,
                                                     WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                                     m_https ? WINHTTP_FLAG_SECURE : 0);
            if (req)
            {
                const std::wstring headers = L"Authorization: Bearer " + widen(m_token) +
                                             L"\r\nContent-Type: application/json";
                const BOOL sent = WinHttpSendRequest(
                    req, headers.c_str(), (DWORD)headers.size(),
                    body ? (LPVOID)body->data() : WINHTTP_NO_REQUEST_DATA, body ? (DWORD)body->size() : 0,
                    body ? (DWORD)body->size() : 0, 0);
                if (sent && WinHttpReceiveResponse(req, nullptr))
                {
                    std::string data;
                    DWORD available = 0;
                    while (WinHttpQueryDataAvailable(req, &available) && available > 0)
                    {
                        const size_t offset = data.size();
                        data.resize(offset + available);
                        DWORD read = 0;
                        if (!WinHttpReadData(req, data.data() + offset, available, &read)) break;
                        data.resize(offset + read);
                    }
                    result = std::move(data);
                }
                else
                {
                    send<Warning>(STR("[PalKeeperMod] pedido HTTP falhou (GetLastError={})\n"), GetLastError());
                }
                WinHttpCloseHandle(req);
            }
            WinHttpCloseHandle(connect);
        }
        WinHttpCloseHandle(session);
        return result;
    }
}
