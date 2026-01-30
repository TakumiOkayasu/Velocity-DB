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

#include "../utils/logger.h"

#include <atomic>
#include <format>
#include <fstream>
#include <thread>

namespace velocitydb {

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
inline int getLastSocketError() {
    return WSAGetLastError();
}
#else
using socket_t = int;
constexpr socket_t INVALID_SOCK = -1;
inline int closeSocket(socket_t s) {
    return close(s);
}
inline void initWsa() {}
inline int getLastSocketError() {
    return errno;
}
#endif

constexpr int BUFFER_SIZE = 16384;

}  // namespace

class SshTunnel::Impl {
public:
    Impl() = default;
    ~Impl() { disconnect(); }

    std::expected<void, SshTunnelError> connect(const SshTunnelConfig& config) {
        log<LogLevel::INFO>("[SSH] Starting SSH tunnel connection...");
        log<LogLevel::INFO>(std::format("[SSH] SSH Host: {}:{}", config.host, config.port));
        log<LogLevel::INFO>(std::format("[SSH] Remote target: {}:{}", config.remoteHost, config.remotePort));
        log<LogLevel::INFO>(std::format("[SSH] Username: {}", config.username));
        log<LogLevel::INFO>(std::format("[SSH] Auth method: {}", config.authMethod == SshAuthMethod::Password ? "password" : "publickey"));
        log_flush();

        initWsa();

        // Initialize libssh2
        log<LogLevel::DEBUG>("[SSH] Initializing libssh2...");
        if (libssh2_init(0) != 0) {
            log<LogLevel::ERROR_LEVEL>("[SSH] Failed to initialize libssh2");
            return std::unexpected(SshTunnelError{SshTunnelError::Code::Unknown, "Failed to initialize libssh2"});
        }
        m_libssh2Initialized = true;
        log<LogLevel::DEBUG>("[SSH] libssh2 initialized successfully");

        // Create socket and connect to SSH server
        log<LogLevel::DEBUG>("[SSH] Creating SSH socket...");
        m_sshSocket = socket(AF_INET, SOCK_STREAM, 0);
        if (m_sshSocket == INVALID_SOCK) {
            log<LogLevel::ERROR_LEVEL>("[SSH] Failed to create socket");
            return std::unexpected(SshTunnelError{SshTunnelError::Code::SocketError, "Failed to create socket"});
        }
        log<LogLevel::DEBUG>("[SSH] Socket created successfully");

        // Resolve hostname
        log<LogLevel::DEBUG>(std::format("[SSH] Resolving hostname: {}", config.host));
        addrinfo hints{};
        hints.ai_family = AF_INET;
        hints.ai_socktype = SOCK_STREAM;

        addrinfo* result = nullptr;
        auto portStr = std::to_string(config.port);
        if (getaddrinfo(config.host.c_str(), portStr.c_str(), &hints, &result) != 0 || !result) {
            log<LogLevel::ERROR_LEVEL>(std::format("[SSH] Failed to resolve hostname: {}", config.host));
            return std::unexpected(SshTunnelError{SshTunnelError::Code::ConnectionFailed, std::format("Failed to resolve hostname: {}", config.host)});
        }
        log<LogLevel::DEBUG>("[SSH] Hostname resolved successfully");

        log<LogLevel::DEBUG>(std::format("[SSH] Connecting to SSH server {}:{}...", config.host, config.port));
        int connectResult = ::connect(m_sshSocket, result->ai_addr, static_cast<int>(result->ai_addrlen));
        freeaddrinfo(result);

        if (connectResult != 0) {
            int err = getLastSocketError();
            log<LogLevel::ERROR_LEVEL>(std::format("[SSH] Failed to connect to {}:{}, error: {}", config.host, config.port, err));
            return std::unexpected(SshTunnelError{SshTunnelError::Code::ConnectionFailed, std::format("Failed to connect to {}:{}", config.host, config.port)});
        }
        log<LogLevel::INFO>("[SSH] Connected to SSH server successfully");

        // Create SSH session
        log<LogLevel::DEBUG>("[SSH] Creating SSH session...");
        m_session = libssh2_session_init();
        if (!m_session) {
            log<LogLevel::ERROR_LEVEL>("[SSH] Failed to create SSH session");
            return std::unexpected(SshTunnelError{SshTunnelError::Code::Unknown, "Failed to create SSH session"});
        }
        log<LogLevel::DEBUG>("[SSH] SSH session created");

        // Set blocking mode for handshake and auth
        libssh2_session_set_blocking(m_session, 1);

        // Perform SSH handshake
        log<LogLevel::DEBUG>("[SSH] Performing SSH handshake...");
        log_flush();
        if (libssh2_session_handshake(m_session, m_sshSocket) != 0) {
            char* errMsg = nullptr;
            libssh2_session_last_error(m_session, &errMsg, nullptr, 0);
            log<LogLevel::ERROR_LEVEL>(std::format("[SSH] SSH handshake failed: {}", errMsg ? errMsg : "unknown"));
            return std::unexpected(SshTunnelError{SshTunnelError::Code::ConnectionFailed, std::format("SSH handshake failed: {}", errMsg ? errMsg : "unknown")});
        }
        log<LogLevel::INFO>("[SSH] SSH handshake completed successfully");

        // Authenticate
        log<LogLevel::DEBUG>("[SSH] Authenticating...");
        log_flush();
        auto authResult = authenticate(config);
        if (!authResult) {
            log<LogLevel::ERROR_LEVEL>(std::format("[SSH] Authentication failed: {}", authResult.error().message));
            return authResult;
        }
        log<LogLevel::INFO>("[SSH] Authentication successful");

        // Store remote target info
        m_remoteHost = config.remoteHost;
        m_remotePort = config.remotePort;

        // Create local listener socket
        log<LogLevel::DEBUG>("[SSH] Creating local listener socket...");
        m_listenerSocket = socket(AF_INET, SOCK_STREAM, 0);
        if (m_listenerSocket == INVALID_SOCK) {
            log<LogLevel::ERROR_LEVEL>("[SSH] Failed to create listener socket");
            return std::unexpected(SshTunnelError{SshTunnelError::Code::SocketError, "Failed to create listener socket"});
        }

        // Allow address reuse
        int optval = 1;
        setsockopt(m_listenerSocket, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&optval), sizeof(optval));

        // Bind to localhost with OS-assigned port
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        addr.sin_port = 0;

        if (bind(m_listenerSocket, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
            log<LogLevel::ERROR_LEVEL>("[SSH] Failed to bind listener socket");
            return std::unexpected(SshTunnelError{SshTunnelError::Code::TunnelFailed, "Failed to bind listener socket"});
        }

        // Get assigned port
        socklen_t addrLen = sizeof(addr);
        if (getsockname(m_listenerSocket, reinterpret_cast<sockaddr*>(&addr), &addrLen) != 0) {
            log<LogLevel::ERROR_LEVEL>("[SSH] Failed to get listener port");
            return std::unexpected(SshTunnelError{SshTunnelError::Code::TunnelFailed, "Failed to get listener port"});
        }
        m_localPort = ntohs(addr.sin_port);
        log<LogLevel::INFO>(std::format("[SSH] Local listener bound to port {}", m_localPort));

        // Start listening
        if (listen(m_listenerSocket, 1) != 0) {
            log<LogLevel::ERROR_LEVEL>("[SSH] Failed to listen on socket");
            return std::unexpected(SshTunnelError{SshTunnelError::Code::TunnelFailed, "Failed to listen on socket"});
        }
        log<LogLevel::DEBUG>("[SSH] Listening on local port");

        m_running = true;
        m_connected = true;

        // Start proxy thread
        log<LogLevel::INFO>("[SSH] Starting proxy thread...");
        log_flush();
        m_proxyThread = std::thread(&Impl::proxyLoop, this);

        log<LogLevel::INFO>(std::format("[SSH] SSH tunnel established: localhost:{} -> {}:{}", m_localPort, m_remoteHost, m_remotePort));
        log_flush();

        return {};
    }

    void disconnect() {
        log<LogLevel::DEBUG>("[SSH] Disconnecting SSH tunnel...");
        m_running = false;

        // Close listener to unblock accept()
        if (m_listenerSocket != INVALID_SOCK) {
            closeSocket(m_listenerSocket);
            m_listenerSocket = INVALID_SOCK;
        }

        // Close client socket if connected
        if (m_clientSocket != INVALID_SOCK) {
            closeSocket(m_clientSocket);
            m_clientSocket = INVALID_SOCK;
        }

        // Wait for proxy thread
        if (m_proxyThread.joinable()) {
            log<LogLevel::DEBUG>("[SSH] Waiting for proxy thread to finish...");
            m_proxyThread.join();
        }

        // Clean up SSH channel
        if (m_channel) {
            libssh2_channel_close(m_channel);
            libssh2_channel_free(m_channel);
            m_channel = nullptr;
        }

        // Clean up SSH session
        if (m_session) {
            libssh2_session_disconnect(m_session, "Disconnecting");
            libssh2_session_free(m_session);
            m_session = nullptr;
        }

        // Close SSH socket
        if (m_sshSocket != INVALID_SOCK) {
            closeSocket(m_sshSocket);
            m_sshSocket = INVALID_SOCK;
        }

        if (m_libssh2Initialized) {
            libssh2_exit();
            m_libssh2Initialized = false;
        }

        m_connected = false;
        m_localPort = 0;
        log<LogLevel::INFO>("[SSH] SSH tunnel disconnected");
        log_flush();
    }

    [[nodiscard]] bool isConnected() const { return m_connected; }

    [[nodiscard]] int getLocalPort() const { return m_localPort; }

private:
    void proxyLoop() {
        log<LogLevel::DEBUG>("[SSH] Proxy thread started, waiting for connections...");
        log_flush();

        while (m_running) {
            // Accept client connection
            sockaddr_in clientAddr{};
            socklen_t clientAddrLen = sizeof(clientAddr);

            log<LogLevel::DEBUG>("[SSH] Waiting for client connection on accept()...");
            log_flush();

            socket_t client = accept(m_listenerSocket, reinterpret_cast<sockaddr*>(&clientAddr), &clientAddrLen);
            if (client == INVALID_SOCK) {
                if (!m_running) {
                    log<LogLevel::DEBUG>("[SSH] Accept interrupted by shutdown");
                    break;  // Normal shutdown
                }
                int err = getLastSocketError();
                log<LogLevel::WARNING>(std::format("[SSH] Accept failed with error: {}", err));
                continue;
            }

            log<LogLevel::INFO>("[SSH] Client connected to tunnel!");
            log_flush();

            m_clientSocket = client;

            // Open SSH channel for port forwarding
            log<LogLevel::DEBUG>(std::format("[SSH] Opening direct-tcpip channel to {}:{}...", m_remoteHost, m_remotePort));
            log_flush();

            m_channel = libssh2_channel_direct_tcpip(m_session, m_remoteHost.c_str(), m_remotePort);
            if (!m_channel) {
                char* errMsg = nullptr;
                libssh2_session_last_error(m_session, &errMsg, nullptr, 0);
                log<LogLevel::ERROR_LEVEL>(std::format("[SSH] Failed to open direct-tcpip channel: {}", errMsg ? errMsg : "unknown"));
                log_flush();
                closeSocket(client);
                m_clientSocket = INVALID_SOCK;
                continue;
            }

            log<LogLevel::INFO>("[SSH] SSH channel opened successfully");
            log_flush();

            // Set non-blocking mode for data transfer
            libssh2_channel_set_blocking(m_channel, 0);

            // Set socket to non-blocking
#ifdef _WIN32
            u_long mode = 1;
            ioctlsocket(client, FIONBIO, &mode);
#else
            int flags = fcntl(client, F_GETFL, 0);
            fcntl(client, F_SETFL, flags | O_NONBLOCK);
#endif

            // Proxy data between client and SSH channel
            log<LogLevel::DEBUG>("[SSH] Starting data proxy...");
            log_flush();
            proxyData(client);

            log<LogLevel::INFO>("[SSH] Data proxy ended");
            log_flush();

            // Cleanup
            if (m_channel) {
                libssh2_channel_close(m_channel);
                libssh2_channel_free(m_channel);
                m_channel = nullptr;
            }

            closeSocket(client);
            m_clientSocket = INVALID_SOCK;
        }

        log<LogLevel::DEBUG>("[SSH] Proxy thread exiting");
        log_flush();
    }

    void proxyData(socket_t client) {
        char buffer[BUFFER_SIZE];
        int loopCount = 0;
        int totalBytesFromClient = 0;
        int totalBytesFromServer = 0;

        while (m_running) {
            bool activity = false;
            loopCount++;

            // Log periodically
            if (loopCount % 1000 == 0) {
                log<LogLevel::DEBUG>(std::format("[SSH] Proxy loop iteration {}, client->server: {} bytes, server->client: {} bytes", loopCount, totalBytesFromClient, totalBytesFromServer));
                log_flush();
            }

            // Read from client, write to SSH channel
            int bytesRead = recv(client, buffer, BUFFER_SIZE, 0);
            if (bytesRead > 0) {
                activity = true;
                totalBytesFromClient += bytesRead;
                log<LogLevel::DEBUG>(std::format("[SSH] Received {} bytes from client", bytesRead));

                int totalWritten = 0;
                while (totalWritten < bytesRead && m_running) {
                    int written = static_cast<int>(libssh2_channel_write(m_channel, buffer + totalWritten, bytesRead - totalWritten));
                    if (written > 0) {
                        totalWritten += written;
                        log<LogLevel::DEBUG>(std::format("[SSH] Wrote {} bytes to SSH channel (total: {})", written, totalWritten));
                    } else if (written == LIBSSH2_ERROR_EAGAIN) {
                        std::this_thread::sleep_for(std::chrono::milliseconds(1));
                    } else {
                        char* errMsg = nullptr;
                        libssh2_session_last_error(m_session, &errMsg, nullptr, 0);
                        log<LogLevel::ERROR_LEVEL>(std::format("[SSH] Channel write error: {} ({})", written, errMsg ? errMsg : "unknown"));
                        log_flush();
                        return;  // Error
                    }
                }
            } else if (bytesRead == 0) {
                log<LogLevel::INFO>("[SSH] Client disconnected (recv returned 0)");
                log_flush();
                return;  // Client disconnected
            } else {
#ifdef _WIN32
                int err = WSAGetLastError();
                if (err != WSAEWOULDBLOCK) {
                    log<LogLevel::ERROR_LEVEL>(std::format("[SSH] Recv error: {}", err));
                    log_flush();
                    return;
                }
#else
                if (errno != EAGAIN && errno != EWOULDBLOCK) {
                    log<LogLevel::ERROR_LEVEL>(std::format("[SSH] Recv error: {}", errno));
                    log_flush();
                    return;
                }
#endif
            }

            // Read from SSH channel, write to client
            ssize_t channelRead = libssh2_channel_read(m_channel, buffer, BUFFER_SIZE);
            if (channelRead > 0) {
                activity = true;
                totalBytesFromServer += static_cast<int>(channelRead);
                log<LogLevel::DEBUG>(std::format("[SSH] Received {} bytes from SSH channel", channelRead));

                int totalSent = 0;
                while (totalSent < channelRead && m_running) {
                    int sent = send(client, buffer + totalSent, static_cast<int>(channelRead - totalSent), 0);
                    if (sent > 0) {
                        totalSent += sent;
                        log<LogLevel::DEBUG>(std::format("[SSH] Sent {} bytes to client (total: {})", sent, totalSent));
                    } else if (sent < 0) {
#ifdef _WIN32
                        int err = WSAGetLastError();
                        if (err == WSAEWOULDBLOCK) {
                            std::this_thread::sleep_for(std::chrono::milliseconds(1));
                            continue;
                        }
                        log<LogLevel::ERROR_LEVEL>(std::format("[SSH] Send error: {}", err));
#else
                        if (errno == EAGAIN || errno == EWOULDBLOCK) {
                            std::this_thread::sleep_for(std::chrono::milliseconds(1));
                            continue;
                        }
                        log<LogLevel::ERROR_LEVEL>(std::format("[SSH] Send error: {}", errno));
#endif
                        log_flush();
                        return;  // Error
                    }
                }
            } else if (channelRead == 0 || libssh2_channel_eof(m_channel)) {
                log<LogLevel::INFO>("[SSH] SSH channel closed (EOF)");
                log_flush();
                return;  // Channel closed
            } else if (channelRead != LIBSSH2_ERROR_EAGAIN) {
                char* errMsg = nullptr;
                libssh2_session_last_error(m_session, &errMsg, nullptr, 0);
                log<LogLevel::ERROR_LEVEL>(std::format("[SSH] Channel read error: {} ({})", channelRead, errMsg ? errMsg : "unknown"));
                log_flush();
                return;  // Error
            }

            // Avoid busy loop
            if (!activity) {
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
        }

        log<LogLevel::DEBUG>(std::format("[SSH] Proxy data loop ended. Total: client->server: {} bytes, server->client: {} bytes", totalBytesFromClient, totalBytesFromServer));
        log_flush();
    }

    std::expected<void, SshTunnelError> authenticate(const SshTunnelConfig& config) {
        int rc = 0;

        if (config.authMethod == SshAuthMethod::Password) {
            log<LogLevel::DEBUG>("[SSH] Attempting password authentication...");
            rc = libssh2_userauth_password(m_session, config.username.c_str(), config.password.c_str());
        } else {
            // Public key authentication
            std::string publicKeyPath = config.privateKeyPath + ".pub";
            const char* passphrase = config.keyPassphrase.empty() ? nullptr : config.keyPassphrase.c_str();

            log<LogLevel::DEBUG>(std::format("[SSH] Attempting public key authentication with key: {}", config.privateKeyPath));
            log<LogLevel::DEBUG>(std::format("[SSH] Looking for public key at: {}", publicKeyPath));

            rc = libssh2_userauth_publickey_fromfile(m_session, config.username.c_str(), publicKeyPath.c_str(), config.privateKeyPath.c_str(), passphrase);

            // If public key file doesn't exist, try with just private key
            if (rc != 0) {
                log<LogLevel::DEBUG>("[SSH] Public key auth with .pub failed, trying without .pub file...");
                rc = libssh2_userauth_publickey_fromfile(m_session, config.username.c_str(), nullptr, config.privateKeyPath.c_str(), passphrase);
            }
        }

        if (rc != 0) {
            char* errMsg = nullptr;
            libssh2_session_last_error(m_session, &errMsg, nullptr, 0);
            log<LogLevel::ERROR_LEVEL>(std::format("[SSH] Authentication failed (rc={}): {}", rc, errMsg ? errMsg : "unknown"));
            return std::unexpected(SshTunnelError{SshTunnelError::Code::AuthenticationFailed, std::format("Authentication failed: {}", errMsg ? errMsg : "unknown")});
        }

        return {};
    }

    socket_t m_sshSocket = INVALID_SOCK;
    socket_t m_listenerSocket = INVALID_SOCK;
    socket_t m_clientSocket = INVALID_SOCK;
    LIBSSH2_SESSION* m_session = nullptr;
    LIBSSH2_CHANNEL* m_channel = nullptr;
    bool m_libssh2Initialized = false;
    std::atomic<bool> m_connected{false};
    std::atomic<bool> m_running{false};
    int m_localPort = 0;
    std::string m_remoteHost;
    int m_remotePort = 0;
    std::thread m_proxyThread;
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

}  // namespace velocitydb
