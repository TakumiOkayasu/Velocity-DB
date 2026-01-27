#include "ssh_tunnel.h"

#include <libssh2.h>

#ifdef _WIN32
#include <WS2tcpip.h>
#include <winsock2.h>
#pragma comment(lib, "ws2_32.lib")
#else
#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

#include <format>
#include <fstream>
#include <random>

namespace predategrip {

namespace {

#ifdef _WIN32
using socket_t = SOCKET;
constexpr socket_t INVALID_SOCK = INVALID_SOCKET;
inline int closeSocket(socket_t s) {
    return closesocket(s);
}
inline void initWsa() {
    static bool initialized = false;
    if (!initialized) {
        WSADATA wsaData;
        WSAStartup(MAKEWORD(2, 2), &wsaData);
        initialized = true;
    }
}
#else
using socket_t = int;
constexpr socket_t INVALID_SOCK = -1;
inline int closeSocket(socket_t s) {
    return close(s);
}
inline void initWsa() {}
#endif

// Find an available local port for the tunnel
int findAvailablePort() {
    initWsa();
    socket_t sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock == INVALID_SOCK) {
        return 0;
    }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;  // Let OS assign port

    if (bind(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        closeSocket(sock);
        return 0;
    }

    socklen_t addrLen = sizeof(addr);
    if (getsockname(sock, reinterpret_cast<sockaddr*>(&addr), &addrLen) != 0) {
        closeSocket(sock);
        return 0;
    }

    int port = ntohs(addr.sin_port);
    closeSocket(sock);
    return port;
}

std::string readFile(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        return "";
    }
    return std::string{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}

}  // namespace

class SshTunnel::Impl {
public:
    Impl() = default;
    ~Impl() { disconnect(); }

    std::expected<void, SshTunnelError> connect(const SshTunnelConfig& config) {
        initWsa();

        // Initialize libssh2
        if (libssh2_init(0) != 0) {
            return std::unexpected(SshTunnelError{SshTunnelError::Code::Unknown, "Failed to initialize libssh2"});
        }
        m_libssh2Initialized = true;

        // Create socket and connect to SSH server
        m_socket = socket(AF_INET, SOCK_STREAM, 0);
        if (m_socket == INVALID_SOCK) {
            return std::unexpected(SshTunnelError{SshTunnelError::Code::SocketError, "Failed to create socket"});
        }

        // Resolve hostname
        addrinfo hints{};
        hints.ai_family = AF_INET;
        hints.ai_socktype = SOCK_STREAM;

        addrinfo* result = nullptr;
        auto portStr = std::to_string(config.port);
        if (getaddrinfo(config.host.c_str(), portStr.c_str(), &hints, &result) != 0 || !result) {
            return std::unexpected(SshTunnelError{SshTunnelError::Code::ConnectionFailed, std::format("Failed to resolve hostname: {}", config.host)});
        }

        int connectResult = ::connect(m_socket, result->ai_addr, static_cast<int>(result->ai_addrlen));
        freeaddrinfo(result);

        if (connectResult != 0) {
            return std::unexpected(SshTunnelError{SshTunnelError::Code::ConnectionFailed, std::format("Failed to connect to {}:{}", config.host, config.port)});
        }

        // Create SSH session
        m_session = libssh2_session_init();
        if (!m_session) {
            return std::unexpected(SshTunnelError{SshTunnelError::Code::Unknown, "Failed to create SSH session"});
        }

        // Set non-blocking mode
        libssh2_session_set_blocking(m_session, 1);

        // Perform SSH handshake
        if (libssh2_session_handshake(m_session, m_socket) != 0) {
            char* errMsg = nullptr;
            libssh2_session_last_error(m_session, &errMsg, nullptr, 0);
            return std::unexpected(SshTunnelError{SshTunnelError::Code::ConnectionFailed, std::format("SSH handshake failed: {}", errMsg ? errMsg : "unknown")});
        }

        // Authenticate
        auto authResult = authenticate(config);
        if (!authResult) {
            return authResult;
        }

        // Set up port forwarding
        m_localPort = findAvailablePort();
        if (m_localPort == 0) {
            return std::unexpected(SshTunnelError{SshTunnelError::Code::TunnelFailed, "Failed to find available local port"});
        }

        // Store remote target info for later use
        m_remoteHost = config.remoteHost;
        m_remotePort = config.remotePort;
        m_connected = true;

        return {};
    }

    void disconnect() {
        if (m_channel) {
            libssh2_channel_free(m_channel);
            m_channel = nullptr;
        }
        if (m_session) {
            libssh2_session_disconnect(m_session, "Disconnecting");
            libssh2_session_free(m_session);
            m_session = nullptr;
        }
        if (m_socket != INVALID_SOCK) {
            closeSocket(m_socket);
            m_socket = INVALID_SOCK;
        }
        if (m_libssh2Initialized) {
            libssh2_exit();
            m_libssh2Initialized = false;
        }
        m_connected = false;
        m_localPort = 0;
    }

    [[nodiscard]] bool isConnected() const { return m_connected; }

    [[nodiscard]] int getLocalPort() const { return m_localPort; }

    // Open a channel for direct-tcpip (port forwarding)
    [[nodiscard]] LIBSSH2_CHANNEL* openForwardChannel() {
        if (!m_connected || !m_session) {
            return nullptr;
        }
        return libssh2_channel_direct_tcpip(m_session, m_remoteHost.c_str(), m_remotePort);
    }

    [[nodiscard]] LIBSSH2_SESSION* getSession() const { return m_session; }

private:
    std::expected<void, SshTunnelError> authenticate(const SshTunnelConfig& config) {
        int rc = 0;

        if (config.authMethod == SshAuthMethod::Password) {
            rc = libssh2_userauth_password(m_session, config.username.c_str(), config.password.c_str());
        } else {
            // Public key authentication
            std::string publicKeyPath = config.privateKeyPath + ".pub";
            const char* passphrase = config.keyPassphrase.empty() ? nullptr : config.keyPassphrase.c_str();

            rc = libssh2_userauth_publickey_fromfile(m_session, config.username.c_str(), publicKeyPath.c_str(), config.privateKeyPath.c_str(), passphrase);

            // If public key file doesn't exist, try with just private key
            if (rc != 0) {
                rc = libssh2_userauth_publickey_fromfile(m_session, config.username.c_str(), nullptr, config.privateKeyPath.c_str(), passphrase);
            }
        }

        if (rc != 0) {
            char* errMsg = nullptr;
            libssh2_session_last_error(m_session, &errMsg, nullptr, 0);
            return std::unexpected(SshTunnelError{SshTunnelError::Code::AuthenticationFailed, std::format("Authentication failed: {}", errMsg ? errMsg : "unknown")});
        }

        return {};
    }

    socket_t m_socket = INVALID_SOCK;
    LIBSSH2_SESSION* m_session = nullptr;
    LIBSSH2_CHANNEL* m_channel = nullptr;
    bool m_libssh2Initialized = false;
    bool m_connected = false;
    int m_localPort = 0;
    std::string m_remoteHost;
    int m_remotePort = 0;
};

SshTunnel::SshTunnel() : m_impl(std::make_unique<Impl>()) {}

SshTunnel::~SshTunnel() = default;

SshTunnel::SshTunnel(SshTunnel&&) noexcept = default;

SshTunnel& SshTunnel::operator=(SshTunnel&&) noexcept = default;

std::expected<void, SshTunnelError> SshTunnel::connect(const SshTunnelConfig& config) {
    return m_impl->connect(config);
}

void SshTunnel::disconnect() {
    m_impl->disconnect();
}

bool SshTunnel::isConnected() const {
    return m_impl->isConnected();
}

int SshTunnel::getLocalPort() const {
    return m_impl->getLocalPort();
}

}  // namespace predategrip
